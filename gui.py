"""
Tkinter front-end for scraper.js.

This is only a UI layer: it shells out to `node scraper.js "<query>" <count>`
and streams the CLI's stdout into the window. All scraping logic lives in
scraper.js.
"""
import os
import queue
import subprocess
import sys
import threading
import time
import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox


def app_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


class ScraperGUI(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("G-Map Leads Gen")
        self.geometry("720x520")
        self.minsize(560, 400)

        self.output_queue = queue.Queue()
        self.process = None
        self.last_out_file = None
        self.last_excel_file = None
        self.start_time = None
        self.timer_running = False

        self._build_widgets()
        self.after(100, self._poll_queue)

    def _build_widgets(self):
        form = ttk.Frame(self, padding=10)
        form.pack(fill="x")

        ttk.Label(form, text="Search term:").grid(row=0, column=0, sticky="w")
        self.query_entry = ttk.Entry(form)
        self.query_entry.insert(0, "Appliance repair service in Sacramento, CA, USA")
        self.query_entry.grid(row=0, column=1, sticky="ew", padx=5)

        ttk.Label(form, text="Number of results:").grid(row=1, column=0, sticky="w", pady=(6, 0))
        self.count_entry = ttk.Entry(form, width=10)
        self.count_entry.insert(0, "10")
        self.count_entry.grid(row=1, column=1, sticky="w", padx=5, pady=(6, 0))

        form.columnconfigure(1, weight=1)

        btn_frame = ttk.Frame(self, padding=(10, 0))
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

        self.status_label = ttk.Label(self, text="Idle", padding=(10, 6))
        self.status_label.pack(fill="x")

        self.log = scrolledtext.ScrolledText(self, state="disabled", wrap="word")
        self.log.pack(fill="both", expand=True, padx=10, pady=(0, 10))

    def on_run(self):
        query = self.query_entry.get().strip()
        count_raw = self.count_entry.get().strip()

        if not query:
            messagebox.showerror("Missing input", "Please enter a search term.")
            return
        if not count_raw.isdigit() or int(count_raw) <= 0:
            messagebox.showerror("Invalid input", "Number of results must be a positive whole number.")
            return

        self.run_button.config(state="disabled")
        self.open_folder_button.config(state="disabled")
        self.open_excel_button.config(state="disabled")
        self.last_out_file = None
        self.last_excel_file = None
        self._clear_log()
        self.status_label.config(text="Running...")

        self.start_time = time.time()
        self.timer_running = True
        self._tick_timer()

        thread = threading.Thread(target=self._run_scraper, args=(query, count_raw), daemon=True)
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

    def _run_scraper(self, query, count):
        base = app_dir()
        scraper_path = os.path.join(base, "scraper.js")

        if not os.path.exists(scraper_path):
            self.output_queue.put(("error", f"scraper.js not found next to this program at:\n{scraper_path}"))
            self.output_queue.put(("done", None))
            return

        try:
            self.process = subprocess.Popen(
                ["node", scraper_path, query, count],
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
            self.output_queue.put(("line", line.rstrip("\n")))
            if "Saved" in line and "records to" in line:
                try:
                    self.last_out_file = line.split("records to", 1)[1].strip()
                except IndexError:
                    pass
            if "Saved excel summary to" in line:
                try:
                    self.last_excel_file = line.split("Saved excel summary to", 1)[1].strip()
                except IndexError:
                    pass

        self.process.wait()
        self.output_queue.put(("done", self.process.returncode))

    def _poll_queue(self):
        try:
            while True:
                kind, payload = self.output_queue.get_nowait()
                if kind == "line":
                    self._append_log(payload)
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
