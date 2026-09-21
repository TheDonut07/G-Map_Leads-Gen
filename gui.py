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
from datetime import datetime
from tkinter import ttk, scrolledtext, messagebox

from PIL import Image, ImageTk

MAX_TERMS = 50
DEFAULT_QUERY_PLACEHOLDER = "e.g. Appliance repair service in Sacramento, CA, USA"
GENERIC_QUERY_PLACEHOLDER = "Enter a search term..."

BASE_FONT = ("Segoe UI", 12)
BOLD_FONT = ("Segoe UI", 12, "bold")
HEADER_FONT = ("Segoe UI", 13, "bold")
STATUS_FONT = ("Segoe UI", 11)
LOG_FONT = ("Consolas", 10)

PLACEHOLDER_COLOR = "#8a8a8a"
NORMAL_COLOR = "#000000"


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


def add_placeholder(entry, placeholder_text):
    """Show grey placeholder text that clears itself the moment the user types."""
    entry._placeholder = placeholder_text
    entry._has_placeholder = True
    entry.insert(0, placeholder_text)
    entry.configure(foreground=PLACEHOLDER_COLOR)

    def on_focus_in(_event):
        if entry._has_placeholder:
            entry.delete(0, "end")
            entry.configure(foreground=NORMAL_COLOR)
            entry._has_placeholder = False

    def on_focus_out(_event):
        if not entry.get():
            entry.insert(0, entry._placeholder)
            entry.configure(foreground=PLACEHOLDER_COLOR)
            entry._has_placeholder = True

    entry.bind("<FocusIn>", on_focus_in)
    entry.bind("<FocusOut>", on_focus_out)


def entry_value(entry):
    """Real text in an entry, treating an untouched placeholder as empty."""
    if getattr(entry, "_has_placeholder", False):
        return ""
    return entry.get().strip()


class ScraperGUI(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("G-Map Leads Gen")
        self.geometry("920x720")
        self.minsize(760, 560)

        self.output_queue = queue.Queue()
        self.process = None
        self.last_out_file = None
        self.last_excel_file = None
        self.start_time = None
        self.timer_running = False
        self.term_rows = []
        self.batch_file_path = None
        self.stop_flag_path = None
        self.stopped_by_user = False
        self.is_continue_mode = False
        self.resume_data = None
        self.last_run_task_name = None

        self._int_validate_cmd = self.register(self._validate_int)

        self._setup_styles()
        self._set_window_icon()
        self._build_background()
        self._build_widgets()
        self.add_term_row(placeholder=DEFAULT_QUERY_PLACEHOLDER)
        self.after(100, self._poll_queue)

    def _setup_styles(self):
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass

        style.configure(".", font=BASE_FONT)
        style.configure("TLabel", font=BASE_FONT)
        style.configure("TEntry", font=BASE_FONT, padding=4)
        style.configure("TButton", font=BOLD_FONT, padding=6)

        style.configure("Run.TButton", background="#2e7d32", foreground="white")
        style.map("Run.TButton",
                  background=[("active", "#1b5e20"), ("disabled", "#a5d6a7")],
                  foreground=[("disabled", "#e0e0e0")])

        style.configure("Add.TButton", background="#1565c0", foreground="white")
        style.map("Add.TButton",
                  background=[("active", "#0d47a1"), ("disabled", "#90caf9")])

        style.configure("Remove.TButton", background="#c62828", foreground="white", padding=3)
        style.map("Remove.TButton", background=[("active", "#8e0000")])

        style.configure("Stop.TButton", background="#ef6c00", foreground="white")
        style.map("Stop.TButton",
                  background=[("active", "#b34700"), ("disabled", "#ffcc99")])

        style.configure("Secondary.TButton", background="#546e7a", foreground="white")
        style.map("Secondary.TButton",
                  background=[("active", "#37474f"), ("disabled", "#b0bec5")])

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
        self._resize_background(920, 720)

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
        self._resize_card(920, 720)

        header = ttk.Frame(self.card)
        header.pack(fill="x")
        ttk.Label(header, text="Search term", font=HEADER_FONT).grid(row=0, column=0, sticky="w", padx=(2, 5))
        ttk.Label(header, text="Results", font=HEADER_FONT).grid(row=0, column=1, sticky="w")

        rows_outer = ttk.Frame(self.card)
        rows_outer.pack(fill="both", expand=False, pady=(6, 8))
        rows_outer.configure(height=220)
        rows_outer.pack_propagate(False)

        self.rows_canvas = tk.Canvas(rows_outer, highlightthickness=0)
        rows_scrollbar = ttk.Scrollbar(rows_outer, orient="vertical", command=self.rows_canvas.yview)
        self.rows_canvas.configure(yscrollcommand=rows_scrollbar.set)
        self.rows_canvas.pack(side="left", fill="both", expand=True)
        rows_scrollbar.pack(side="right", fill="y")

        self.rows_frame = ttk.Frame(self.rows_canvas)
        self._rows_window = self.rows_canvas.create_window((0, 0), window=self.rows_frame, anchor="nw")
        self.rows_frame.bind("<Configure>", lambda e: self.rows_canvas.configure(scrollregion=self.rows_canvas.bbox("all")))
        self.rows_canvas.bind("<Configure>", self._on_rows_canvas_configure)

        # Scope mouse-wheel scrolling to the rows area only, so it doesn't hijack log scrolling.
        self._bind_rows_mousewheel(self.rows_canvas)
        self._bind_rows_mousewheel(self.rows_frame)

        add_frame = ttk.Frame(self.card)
        add_frame.pack(fill="x")
        self.add_row_button = ttk.Button(add_frame, text="+ Add search term", style="Add.TButton",
                                          command=self.on_add_row)
        self.add_row_button.pack(side="left")
        self.term_count_label = ttk.Label(add_frame, text="", font=STATUS_FONT)
        self.term_count_label.pack(side="left", padx=(10, 0))

        btn_frame = ttk.Frame(self.card, padding=(0, 12, 0, 0))
        btn_frame.pack(fill="x")

        self.run_button = ttk.Button(btn_frame, text="Run", style="Run.TButton", command=self.on_run)
        self.run_button.pack(side="left")

        self.stop_button = ttk.Button(
            btn_frame, text="Stop & Save", style="Stop.TButton",
            command=self.on_stop_save, state="disabled"
        )
        self.stop_button.pack(side="left", padx=(8, 0))

        self.open_folder_button = ttk.Button(
            btn_frame, text="Open results folder", style="Secondary.TButton",
            command=self.on_open_results, state="disabled"
        )
        self.open_folder_button.pack(side="left", padx=(8, 0))

        self.open_excel_button = ttk.Button(
            btn_frame, text="Open Excel result", style="Secondary.TButton",
            command=self.on_open_excel, state="disabled"
        )
        self.open_excel_button.pack(side="left", padx=(8, 0))

        self.timer_label = ttk.Label(btn_frame, text="Elapsed: 00:00", font=BOLD_FONT, padding=(10, 0))
        self.timer_label.pack(side="right")

        self.status_label = ttk.Label(self.card, text="Idle", font=STATUS_FONT, padding=(0, 8))
        self.status_label.pack(fill="x")

        # Packed with side="bottom" so it stays pinned at the very bottom of the window,
        # outside both the scrollable rows area and the log — always visible.
        task_frame = ttk.Frame(self.card, padding=(0, 8, 0, 0))
        task_frame.pack(side="bottom", fill="x")
        ttk.Label(task_frame, text="Task name:", font=BOLD_FONT).pack(side="left")
        self.task_name_entry = ttk.Entry(task_frame)
        self.task_name_entry.pack(side="left", fill="x", expand=True, padx=(8, 0))
        add_placeholder(self.task_name_entry, self._default_task_name())

        self.log = scrolledtext.ScrolledText(self.card, state="disabled", wrap="word", height=20, font=LOG_FONT)
        self.log.pack(fill="both", expand=True, pady=(0, 0))

        self._update_row_controls()

    def _default_task_name(self):
        date_str = datetime.now().strftime("%d%B%Y")
        return f"SearchTerms{len(self.term_rows)}_{date_str}"

    def _update_task_name_placeholder(self):
        entry = getattr(self, "task_name_entry", None)
        if entry is None:
            return
        if getattr(entry, "_has_placeholder", True):
            new_default = self._default_task_name()
            entry.delete(0, "end")
            entry.insert(0, new_default)
            entry.configure(foreground=PLACEHOLDER_COLOR)
            entry._placeholder = new_default
            entry._has_placeholder = True

    def _bind_rows_mousewheel(self, widget):
        widget.bind("<MouseWheel>", self._on_rows_mousewheel)

    def _on_rows_mousewheel(self, event):
        self.rows_canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
        return "break"

    def _on_rows_canvas_configure(self, event):
        self.rows_canvas.itemconfigure(self._rows_window, width=event.width)
        self._reflow_rows(canvas_width=event.width)

    def _reflow_rows(self, canvas_width=None):
        """Lay term rows out left-to-right, wrapping into as many columns as fit —
        so wide/maximized windows use the horizontal space instead of a single column."""
        if not self.term_rows:
            return

        self.update_idletasks()
        if canvas_width is None:
            canvas_width = self.rows_canvas.winfo_width()
        if canvas_width <= 1:
            canvas_width = self.rows_canvas.winfo_reqwidth() or 400

        unit_width = self.term_rows[0]["frame"].winfo_reqwidth() + 16
        cols = max(1, canvas_width // unit_width)

        for i, row in enumerate(self.term_rows):
            r, c = divmod(i, cols)
            row["frame"].grid(row=r, column=c, sticky="w", padx=(0, 16), pady=(0, 6))

    def _validate_int(self, proposed):
        return proposed == "" or proposed.isdigit()

    # -- term rows -----------------------------------------------------

    def add_term_row(self, query_text="", count_text="10", placeholder=None):
        if len(self.term_rows) >= MAX_TERMS:
            return

        row_frame = ttk.Frame(self.rows_frame, padding=(2, 4))

        query_entry = ttk.Entry(row_frame, width=48)
        if query_text:
            query_entry.insert(0, query_text)
        query_entry.grid(row=0, column=0, sticky="w", padx=(0, 8))

        count_entry = ttk.Entry(row_frame, width=8, validate="key",
                                 validatecommand=(self._int_validate_cmd, "%P"))
        count_entry.insert(0, count_text)
        count_entry.grid(row=0, column=1, sticky="w", padx=(0, 8))

        remove_button = ttk.Button(row_frame, text="-", width=3, style="Remove.TButton",
                                    command=lambda: self.remove_term_row(row_data))
        remove_button.grid(row=0, column=2, sticky="w")

        if not query_text:
            add_placeholder(query_entry, placeholder or GENERIC_QUERY_PLACEHOLDER)

        for widget in (row_frame, query_entry, count_entry, remove_button):
            self._bind_rows_mousewheel(widget)

        row_data = {"frame": row_frame, "query_entry": query_entry, "count_entry": count_entry}
        self.term_rows.append(row_data)
        self._reflow_rows()
        self._update_row_controls()

    def remove_term_row(self, row_data):
        if len(self.term_rows) <= 1:
            return
        row_data["frame"].destroy()
        self.term_rows.remove(row_data)
        self._reflow_rows()
        self._update_row_controls()

    def on_add_row(self):
        self.add_term_row(placeholder=GENERIC_QUERY_PLACEHOLDER)

    def _update_row_controls(self):
        at_cap = len(self.term_rows) >= MAX_TERMS
        self.add_row_button.config(state="disabled" if at_cap else "normal")
        self.term_count_label.config(text=f"{len(self.term_rows)} / {MAX_TERMS} search terms")
        self._update_task_name_placeholder()

    def _collect_terms(self):
        """Returns (terms, error_message). terms is a list of {"query", "count"} dicts."""
        terms = []
        for i, row in enumerate(self.term_rows, start=1):
            query = entry_value(row["query_entry"])
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

    def _build_continue_terms(self, current_terms):
        """Merge current row targets with previously saved partial results, matched by
        search-term text, so already-collected listings aren't re-scraped."""
        prior_by_query = {}
        if self.resume_data:
            for t in self.resume_data.get("terms", []):
                prior_by_query[t.get("query", "")] = t

        batch_terms = []
        for t in current_terms:
            prior = prior_by_query.get(t["query"])
            prior_results = prior["results"] if prior else []
            done = len(prior_results)
            remaining = max(0, t["count"] - done)
            batch_terms.append({
                "query": t["query"],
                "count": remaining,
                "skip": done,
                "priorResults": prior_results,
            })
        return batch_terms

    def on_run(self):
        terms, error = self._collect_terms()
        if error:
            messagebox.showerror("Invalid input", error)
            return

        if self.is_continue_mode:
            task_name = self.last_run_task_name
            batch_terms = self._build_continue_terms(terms)
        else:
            task_name = entry_value(self.task_name_entry) or self._default_task_name()
            self.last_run_task_name = task_name
            self.resume_data = None
            batch_terms = [
                {"query": t["query"], "count": t["count"], "skip": 0, "priorResults": []}
                for t in terms
            ]

        batch_payload = {"taskName": task_name, "terms": batch_terms}

        batch_fd, batch_path = tempfile.mkstemp(suffix=".json", prefix="gmap_batch_")
        try:
            with os.fdopen(batch_fd, "w", encoding="utf-8") as f:
                json.dump(batch_payload, f)
        except Exception as exc:
            messagebox.showerror("Error", f"Could not write batch file: {exc}")
            return

        self.batch_file_path = batch_path
        self.stop_flag_path = batch_path + ".stop"
        self.stopped_by_user = False

        self.run_button.config(state="disabled")
        self.stop_button.config(state="normal")
        self.open_folder_button.config(state="disabled")
        self.open_excel_button.config(state="disabled")
        self.last_out_file = None
        self.last_excel_file = None
        if not self.is_continue_mode:
            self._clear_log()
        verb = "Continuing" if self.is_continue_mode else "Running"
        self.status_label.config(text=f"{verb}... (0/{len(batch_terms)} terms)")

        self.start_time = time.time()
        self.timer_running = True
        self._tick_timer()

        thread = threading.Thread(
            target=self._run_scraper, args=(batch_path, self.stop_flag_path), daemon=True
        )
        thread.start()

    def _enter_continue_mode(self):
        self.resume_data = None
        if self.last_out_file and os.path.isfile(self.last_out_file):
            try:
                with open(self.last_out_file, "r", encoding="utf-8") as f:
                    self.resume_data = json.load(f)
            except (OSError, json.JSONDecodeError):
                self.resume_data = None

        if self.resume_data is None:
            self._exit_continue_mode()
            return

        self.is_continue_mode = True
        self.run_button.config(text="Continue")
        self.task_name_entry.config(state="disabled")

    def _exit_continue_mode(self):
        self.is_continue_mode = False
        self.resume_data = None
        self.run_button.config(text="Run")
        self.task_name_entry.config(state="normal")

    def on_stop_save(self):
        if not self.stop_flag_path:
            return
        try:
            with open(self.stop_flag_path, "w", encoding="utf-8") as f:
                f.write("stop")
        except OSError as exc:
            messagebox.showerror("Error", f"Could not signal stop: {exc}")
            return
        self.stop_button.config(state="disabled")
        self.status_label.config(text="Stopping... finishing the current listing and saving collected data.")

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

    def _run_scraper(self, batch_path, stop_flag_path):
        base = app_dir()
        scraper_path = os.path.join(base, "scraper.js")

        try:
            if not os.path.exists(scraper_path):
                self.output_queue.put(("error", f"scraper.js not found next to this program at:\n{scraper_path}"))
                self.output_queue.put(("done", None))
                return

            try:
                self.process = subprocess.Popen(
                    ["node", scraper_path, "--batch", batch_path, "--stop-flag", stop_flag_path],
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

                if line.startswith("Stopped early by user."):
                    self.output_queue.put(("stopped", True))

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
            self.output_queue.put(("done", self.process.returncode))
        finally:
            for path in (batch_path, stop_flag_path):
                try:
                    os.remove(path)
                except OSError:
                    pass
            self.batch_file_path = None
            self.stop_flag_path = None

    def _poll_queue(self):
        try:
            while True:
                kind, payload = self.output_queue.get_nowait()
                if kind == "line":
                    self._append_log(payload)
                elif kind == "progress":
                    current, total = payload
                    if not self.stopped_by_user:
                        verb = "Continuing" if self.is_continue_mode else "Running"
                        self.status_label.config(text=f"{verb}... ({current}/{total} terms)")
                elif kind == "stopped":
                    self.stopped_by_user = True
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
        self.stop_button.config(state="disabled")
        if returncode == 0:
            if self.stopped_by_user:
                self.status_label.config(text=f"Stopped by user — partial results saved. Took {elapsed_text} (mm:ss).")
                self._enter_continue_mode()
            else:
                self.status_label.config(text=f"Done. Took {elapsed_text} (mm:ss).")
                self._exit_continue_mode()
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
