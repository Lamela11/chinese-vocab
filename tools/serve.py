"""
serve.py - runs the vocab app on this laptop: serves this folder at http://127.0.0.1:8642 and
opens it in your browser. "Open vocab app.cmd" starts it; close its window to stop the app.

    python tools/serve.py                # start it and open the browser
    python tools/serve.py --no-browser   # just start it

The address never changes on purpose: the browser keeps your progress per address, so another
port would start you from zero. Only this laptop can open it (127.0.0.1).
"""

import http.server
import socket
import sys
import webbrowser
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8642
URL = f"http://127.0.0.1:{PORT}/"
# Set here rather than taken from Windows, where a program can register .js as text/plain,
# and then the browser refuses to run the app.
TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **TYPES}

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")  # always check for newer files
        super().end_headers()

    def log_message(self, format, *args):
        pass  # keep the window quiet


class Server(http.server.ThreadingHTTPServer):
    # On Windows, reusing the address would let a second copy start on the same port.
    allow_reuse_address = sys.platform != "win32"
    # The browser asks for the app's ten or so files at once; with Python's default of 5 waiting
    # connections, Windows drops the rest and the browser tries again seconds later.
    request_queue_size = 64


def running():
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", PORT)) == 0


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    browser = "--no-browser" not in sys.argv
    if running():
        print(f"The app is already running at {URL}")
        if browser:
            webbrowser.open(URL)
        return
    server = Server(("127.0.0.1", PORT), partial(Handler, directory=str(ROOT)))
    print(f"The vocab app is running at {URL}\n"
          "Keep this window open while you study. Close it to stop the app.")
    if browser:
        webbrowser.open(URL)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
