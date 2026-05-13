from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
import yt_dlp
import os
import uuid

app = FastAPI()

DOWNLOAD_DIR = "downloads"
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

@app.get("/")
def home():
    return {"status": "SnapLoad Backend Running"}

@app.get("/download")
async def download_video(url: str):

    try:

        unique_id = str(uuid.uuid4())

        ydl_opts = {
            "format": "bestvideo+bestaudio/best",
            "outtmpl": f"{DOWNLOAD_DIR}/{unique_id}.%(ext)s",
            "merge_output_format": "mp4",
            "noplaylist": True,
            "quiet": False
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            file_path = ydl.prepare_filename(info)

            if not file_path.endswith(".mp4"):
                possible_mp4 = file_path.rsplit(".", 1)[0] + ".mp4"

                if os.path.exists(possible_mp4):
                    file_path = possible_mp4

        return FileResponse(
            path=file_path,
            media_type='application/octet-stream',
            filename=os.path.basename(file_path)
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))