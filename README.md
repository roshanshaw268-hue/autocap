# AutoCap by Sachin

A responsive caption studio for Indian creators. Upload video/audio, generate timestamped captions with Groq Whisper, edit every line, preview styling, and export SRT/VTT/TXT. Manual caption editing works without an API key.

## Requirements
- Node.js 20+
- A Groq API key for AI transcription (create one at https://console.groq.com/keys)
- FFmpeg is bundled through `ffmpeg-static`

## Run locally
```bash
npm install
cp .env.example .env
```
Open `.env` and add your key:
```env
GROQ_API_KEY=gsk_your_key_here
PORT=3000
```
Then:
```bash
npm start
```
Open http://localhost:3000

## Deploy free on Render
1. Push this project to a new GitHub repository named `autocap`.
2. Sign in at https://render.com and choose **New + → Web Service**.
3. Connect the `autocap` repository.
4. Render detects `render.yaml`. Use build command `npm install` and start command `npm start`.
5. In Environment, add `GROQ_API_KEY` with your Groq key. Do not put the key in frontend code or commit `.env`.
6. Deploy. Open the Render URL.

## Notes
- The backend converts uploaded media to mono 16 kHz MP3 with FFmpeg before sending it to Groq Whisper.
- Upload limit is 200 MB; converted audio must be under 24 MB for the transcription request.
- Groq free-tier quotas, model availability, and request limits can change. Check your Groq dashboard.
- Render free services may sleep when idle and cold starts can take time.
- The preview overlays captions on the video; this version exports subtitle files, not a permanently caption-burned MP4.
- Never share your API key publicly. If exposed, revoke it and create a new one.
