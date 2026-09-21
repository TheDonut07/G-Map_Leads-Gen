"""
Tkinter front-end for scraper.js.

This is only a UI layer: it builds a batch of search-term/result-count rows,
writes them to a small JSON file, and shells out to
`node scraper.js --batch <file>`, streaming the CLI's stdout into the window.
All scraping logic lives in scraper.js / lib/.
"""
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox

from PIL import Image, ImageTk

MAX_TERMS = 50


def app_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def resource_path(*parts):
    """Locate a bundled asset, whether running from source or from the PyInstaller exe."""
    if getattr(sys, "frozen", False):
        base = getattr(sys, "_MEIPASS", app_dir())
    else:
        base = app_dir()
    return os.path.join(base, *parts)


class ScraperGUI(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("G-Map Leads Gen")
        self.geometry("760x640")
        self.minsize(620, 480)

        self.output_queue = queue.Queue()
        self.process = None
        self.last_out_file = None
        self.last_excel_file = None
        self.start_time = None
        self.timer_running = False
        self.term_rows = []
        self.batch_file_path = None

        self._set_window_icon()
        self._build_background()
        self._build_widgets()
        self.add_term_row("Appliance repair service in Sacramento, CA, USA", "10")
        self.after(100, self._poll_queue)

    def _set_window_icon(self):
        icon_path = resource_path("assets", "logo.png")
        if not os.path.exists(icon_path):
            return
        try:
            self._icon_photo = ImageTk.PhotoImage(Image.open(icon_path))
            self.iconphoto(True, self._icon_photo)
        except Exception:
            pass

    def _build_background(self):
        bg_path = resource_path("assets", "background.png")
        self._bg_original = None
        if os.path.exists(bg_path):
            try:
                self._bg_original = Image.open(bg_path).convert("RGB")
            except Exception:
                self._bg_original = None

        self.bg_label = tk.Label(self, borderwidth=0)
        self.bg_label.place(x=0, y=0, relwidth=1, relheight=1)
        self.bg_label.lower()

        self._bg_last_size = None
        self._card_last_size = None
        self._card_margin = 28
        self.bind("<Configure>", self._on_root_configure)
        self._resize_background(760, 640)

    def _on_root_configure(self, event):
        if event.widget is not self:
            return
        self._resize_background(event.width, event.height)
        self._resize_card(event.width, event.height)

    def _resize_card(self, width, height):
        if not hasattr(self, "card"):
            return
        if (width, height) == self._card_last_size:
            return
        self._card_last_size = (width, height)
        margin = self._card_margin
        card_w = max(1, width - margin * 2)
        card_h = max(1, height - margin * 2)
        self.card.place(x=margin, y=margin, width=card_w, height=card_h)

    def _resize_background(self, width, height):
        if not self._bg_original or width <= 1 or height <= 1:
            return
        if (width, height) == self._bg_last_size:
            return
        self._bg_last_size = (width, height)
        resized = self._bg_original.resize((width, height), Image.LANCZOS)
        self._bg_photo = ImageTk.PhotoImage(resized)
        self.bg_label.configure(image=self._bg_photo)

    def _build_widgets(self):
        self.card = ttk.Frame(self, padding=14, relief="raised", borderwidth=1)
        self._resize_card(760, 640)

        header = ttk.Frame(self.card)
        header.pack(fill="x")
        ttk.Label(header, text="Search term", font=("", 9, "bold")).grid(row=0, column=0, sticky="w", padx=(28, 5))
        ttk.Label(header, text="Results", font=("", 9, "bold")).grid(row=0, column=1, sticky="w")
        header.columnconfigure(0, weight=1)

        rows_outer = ttk.Frame(self.card)
        rows_outer.pack(fill="both", expand=True, pady=(4, 6))

        self.rows_canvas = tk.Canvas(rows_outer, highlightthickness=0)
        rows_scrollbar = ttk.Scrollbar(rows_outer, orient="vertical", command=self.rows_canvas.yview)
        self.rows_canvas.configure(yscrollcommand=rows_scrollbar.set)
        self.rows_canvas.pack(side="left", fill="both", expand=True)
        rows_scrollbar.pack(side="right", fill="y")

        self.rows_frame = ttk.Frame(self.rows_canvas)
        self._rows_window = self.rows_canvas.create_window((0, 0), window=self.rows_frame, anchor="nw")
        self.rows_frame.bind("<Configure>", lambda e: self.rows_canvas.configure(scrollregion=self.rows_canvas.bbox("all")))
        self.rows_canvas.bind("<Configure>", lambda e: self.rows_canvas.itemconfigure(self._rows_window, width=e.width))
        self.rows_canvas.bind_all("<MouseWheel>", self._on_mousewheel)

        add_frame = ttk.Frame(self.card)
        add_frame.pack(fill="x")
        self.add_row_button = ttk.Button(add_frame, text="+ Add search term", command=self.on_add_row)
        self.add_row_button.pack(side="left")
        self.term_count_label = ttk.Label(add_frame, text="")
        self.term_count_label.pack(side="left", padx=(10, 0))

        btn_frame = ttk.Frame(self.card, padding=(0, 10, 0, 0))
        btn_frame.pack(fill="x")

        self.run_button = ttk.Button(btn_frame, text="Run", command=self.on_run)
        self.run_button.pack(side="left")

        self.open_folder_button = ttk.Button(
            btn_frame, text="Open results folder", command=self.on_open_results, state="disabled"
        )
        self.open_folder_button.pack(side="left", padx=(8, 0))

        self.open_excel_button = ttk.Button(
            btn_frame, text="Open Excel result", command=self.on_open_excel, state="disabled"
        )
        self.open_excel_button.pack(side="left", padx=(8, 0))

        self.timer_label = ttk.Label(btn_frame, text="Elapsed: 00:00", padding=(10, 0))
        self.timer_label.pack(side="right")

        self.status_label = ttk.Label(self.card, text="Idle", padding=(0, 6))
        self.status_label.pack(fill="x")

        self.log = scrolledtext.ScrolledText(self.card, state="disabled", wrap="word", height=10)
        self.log.pack(fill="both", expand=True, pady=(0, 0))

        self._update_row_controls()

    def _on_mousewheel(self, event):
        self.rows_canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")

    # -- term rows -----------------------------------------------------

    def add_term_row(self, query_text="", count_text="10"):
        if len(self.term_rows) >= MAX_TERMS:
            return

        row_frame = ttk.Frame(self.rows_frame, padding=(0, 2))
        row_frame.pack(fill="x")

        query_entry = ttk.Entry(row_frame)
        query_entry.insert(0, query_text)
        query_entry.pack(side="left", fill="x", expand=True, padx=(0, 5))

        count_entry = ttk.Entry(row_frame, width=8)
        count_entry.insert(0, count_text)
        count_entry.pack(side="left", padx=(0, 5))

        remove_button = ttk.Button(row_frame, text="-", width=3,
                                    command=lambda: self.remove_term_row(row_data))
        remove_button.pack(side="left")

        row_data = {"frame": row_frame, "query_entry": query_entry, "count_entry": count_entry}
        self.term_rows.append(row_data)
        self._update_row_controls()

    def remove_term_row(self, row_data):
        if len(self.term_rows) <= 1:
            return
        row_data["frame"].destroy()
        self.term_rows.remove(row_data)
        self._update_row_controls()

    def on_add_row(self):
        self.add_term_row("", "10")

    def _update_row_controls(self):
        at_cap = len(self.term_rows) >= MAX_TERMS
        self.add_row_button.config(state="disabled" if at_cap else "normal")
        self.term_count_label.config(text=f"{len(self.term_rows)} / {MAX_TERMS} search terms")

    def _collect_terms(self):
        """Returns (terms, error_message). terms is a list of {"query", "count"} dicts."""
        terms = []
        for i, row in enumerate(self.term_rows, start=1):
            query = row["query_entry"].get().strip()
            count_raw = row["count_entry"].get().strip()

            if not query and not count_raw:
                continue
            if not query:
                return None, f"Row {i}: please enter a search term."
            if not count_raw.isdigit() or int(count_raw) <= 0:
                return None, f"Row {i}: number of results must be a positive whole number."

            terms.append({"query": query, "count": int(count_raw)})

        if not terms:
            return None, "Please enter at least one search term."
        return terms, None

    # -- run -------------------------------------------------------------

    def on_run(self):
        terms, error = self._collect_terms()
        if error:
            messagebox.showerror("Invalid input", error)
            return

        self.run_button.config(state="disabled")
        self.open_folder_button.config(state="disabled")
        self.open_excel_button.config(state="disabled")
        self.last_out_file = None
        self.last_excel_file = None
        self._clear_log()
        self.status_label.config(text=f"Running... (0/{len(terms)} terms)")

        self.start_time = time.time()
        self.timer_running = True
        self._tick_timer()

        thread = threading.Thread(target=self._run_scraper, args=(terms,), daemon=True)
        thread.start()

    @staticmethod
    def _format_elapsed(seconds):
        minutes, secs = divmod(int(seconds), 60)
        return f"{minutes:02d}:{secs:02d}"

    def _tick_timer(self):
        if not self.timer_running:
            return
        elapsed = time.time() - self.start_time
        self.timer_label.config(text=f"Elapsed: {self._format_elapsed(elapsed)}")
        self.after(500, self._tick_timer)

    def _run_scraper(self, terms):
        base = app_dir()
        scraper_path = os.path.join(base, "scraper.js")

        if not os.path.exists(scraper_path):
            self.output_queue.put(("error", f"scraper.js not found next to this program at:\n{scraper_path}"))
            self.output_queue.put(("done", None))
            return

        batch_fd, batch_path = tempfile.mkstemp(suffix=".json", prefix="gmap_batch_")
        self.batch_file_path = batch_path
        try:
            with os.fdopen(batch_fd, "w", encoding="utf-8") as f:
                json.dump(terms, f)
        except Exception as exc:
            self.output_queue.put(("error", f"Could not write batch file: {exc}"))
            self.output_queue.put(("done", None))
            return

        try:
            self.process = subprocess.Popen(
                ["node", scraper_path, "--batch", batch_path],
                cwd=base,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
        except FileNotFoundError:
            self.output_queue.put((
                "error",
                "Could not find Node.js on this machine. Run setup.bat first, "
                "then try again.",
            ))
            self.output_queue.put(("done", None))
            return

        for line in self.process.stdout:
            line = line.rstrip("\n")
            self.output_queue.put(("line", line))

            if line.startswith("[Term "):
                try:
                    tag = line.split("]", 1)[0].replace("[Term ", "")
                    current, total = tag.split("/")
                    self.output_queue.put(("progress", (int(current), int(total))))
                except (ValueError, IndexError):
                    pass

            if "Saved" in line and "record(s) across" in line and " to " in line:
                try:
                    self.last_out_file = line.rsplit(" to ", 1)[1].strip()
                except IndexError:
                    pass
            if "Saved excel workbook to" in line:
                try:
                    self.last_excel_file = line.split("Saved excel workbook to", 1)[1].strip()
                except IndexError:
                    pass

        self.process.wait()

        try:
            os.remove(batch_path)
        except OSError:
            pass

        self.output_queue.put(("done", self.process.returncode))

    def _poll_queue(self):
        try:
            while True:
                kind, payload = self.output_queue.get_nowait()
                if kind == "line":
                    self._append_log(payload)
                elif kind == "progress":
                    current, total = payload
                    self.status_label.config(text=f"Running... ({current}/{total} terms)")
                elif kind == "error":
                    self._append_log(f"[error] {payload}")
                elif kind == "done":
                    self._on_finished(payload)
        except queue.Empty:
            pass
        self.after(100, self._poll_queue)

    def _on_finished(self, returncode):
        self.timer_running = False
        elapsed = time.time() - self.start_time if self.start_time else 0
        elapsed_text = self._format_elapsed(elapsed)
        self.timer_label.config(text=f"Elapsed: {elapsed_text}")

        self.run_button.config(state="normal")
        if returncode == 0:
            self.status_label.config(text=f"Done. Took {elapsed_text} (mm:ss).")
            if self.last_out_file:
                self.open_folder_button.config(state="normal")
            if self.last_excel_file:
                self.open_excel_button.config(state="normal")
        else:
            self.status_label.config(text=f"Failed (exit code {returncode}) after {elapsed_text}.")

    def on_open_results(self):
        results_dir = os.path.join(app_dir(), "results")
        if os.path.isdir(results_dir):
            os.startfile(results_dir)
        else:
            messagebox.showinfo("Not found", "No results folder yet.")

    def on_open_excel(self):
        if self.last_excel_file and os.path.isfile(self.last_excel_file):
            os.startfile(self.last_excel_file)
        else:
            messagebox.showinfo("Not found", "No Excel result file yet.")

    def _append_log(self, text):
        self.log.config(state="normal")
        self.log.insert("end", text + "\n")
        self.log.see("end")
        self.log.config(state="disabled")

    def _clear_log(self):
        self.log.config(state="normal")
        self.log.delete("1.0", "end")
        self.log.config(state="disabled")


if __name__ == "__main__":
    ScraperGUI().mainloop()
