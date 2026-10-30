require("dotenv").config();
const express = require("express");
const multer = require("multer");
const Groq = require("groq-sdk");
const ffmpegPath = require("ffmpeg-static");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }
});
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

app.use(express.static(path.join(__dirname, "public")));
app.get("/api/health", (_req, res) => res.json({ ok: true, aiReady: Boolean(groq) }));

function runFfmpeg(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", outputPath];
    const proc = spawn(ffmpegPath, args);
    let err = "";
    proc.stderr.on("data", chunk => { err += chunk.toString(); });
    proc.on("error", reject);
    proc.on("close", code => code === 0 ? resolve() : reject(new Error(err.slice(-1200) || "FFmpeg failed")));
  });
}

app.post("/api/transcribe", upload.single("media"), async (req, res) => {
  if (!groq) return res.status(503).json({ error: "AI is not configured. Add GROQ_API_KEY to your hosting environment. Manual captions still work." });
  if (!req.file) return res.status(400).json({ error: "Please upload a video or audio file." });

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "autocap-"));
  const inputPath = path.join(temp, "source");
  const audioPath = path.join(temp, "audio.mp3");
  try {
    fs.writeFileSync(inputPath, req.file.buffer);
    await runFfmpeg(inputPath, audioPath);
    const stat = fs.statSync(audioPath);
    if (stat.size > 24 * 1024 * 1024) {
      return res.status(413).json({ error: "Audio is larger than 24 MB after conversion. Try a shorter video." });
    }

    const language = String(req.body.language || "auto");
    const options = {
      file: fs.createReadStream(audioPath),
      model: "whisper-large-v3-turbo",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"]
    };
    if (language !== "auto") options.language = language;
    const result = await groq.audio.transcriptions.create(options);
    const segments = (result.segments || []).map((s, i) => ({
      id: i + 1,
      start: Number(s.start || 0),
      end: Number(s.end || (Number(s.start || 0) + 2)),
      text: String(s.text || "").trim()
    })).filter(s => s.text);
    res.json({ text: result.text || "", language: result.language || language, segments });
  } catch (error) {
    console.error("Transcription error:", error);
    res.status(500).json({ error: error.message || "Transcription failed. Please try again." });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`AutoCap running on port ${port}`));
