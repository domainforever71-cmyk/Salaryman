import os

from app import app


if __name__ == "__main__":
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "3000")),
        debug=os.environ.get("FLASK_DEBUG", "1") == "1",
        threaded=True,
    )
