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
      timestamp_granularities: ["segment", "word"]
    };
    if (language !== "auto") options.language = language;
    const result = await groq.audio.transcriptions.create(options);
    const segments = (result.segments || []).map((s, i) => ({
      id: i + 1,
      start: Number(s.start || 0),
      end: Number(s.end || (Number(s.start || 0) + 2)),
      text: String(s.text || "").trim()
    })).filter(s => s.text);
    const words = (result.words || []).map((w, i) => ({
      id: i + 1,
      start: Number(w.start || 0),
      end: Number(w.end || (Number(w.start || 0) + 0.2)),
      text: String(w.word || w.text || "").trim()
    })).filter(w => w.text && Number.isFinite(w.start) && Number.isFinite(w.end));
    res.json({
      text: result.text || "",
      language: result.language || language,
      segments,
      words,
      wordTiming: words.length ? "exact" : "estimated"
    });
  } catch (error) {
    console.error("Transcription error:", error);
    res.status(500).json({ error: error.message || "Transcription failed. Please try again." });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

const exportUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
function assTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(value / 3600), m = Math.floor(value % 3600 / 60), s = (value % 60).toFixed(2);
  return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(Number(s))).padStart(2, "0")}.${String(Math.round((Number(s) % 1) * 100)).padStart(2, "0")}`;
}
function assText(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/{/g, "\\{").replace(/}/g, "\\}").replace(/\r?\n/g, "\\N");
}
app.post("/api/export-mp4", exportUpload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Upload a video before exporting MP4." });
  let cues;
  try { cues = JSON.parse(req.body.captions || "[]"); } catch { return res.status(400).json({ error: "Caption data is invalid." }); }
  if (!Array.isArray(cues) || !cues.length || cues.length > 10000) return res.status(400).json({ error: "No valid captions to export." });
  const safeCues = cues.filter(c => String(c.text || "").trim() && Number.isFinite(Number(c.start)) && Number.isFinite(Number(c.end)) && Number(c.end) > Number(c.start));
  if (!safeCues.length) return res.status(400).json({ error: "Caption timings are invalid." });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "autocap-export-"));
  const input = path.join(temp, "input-video");
  const ass = path.join(temp, "captions.ass");
  const output = path.join(temp, "autocap-captioned.mp4");
  try {
    fs.writeFileSync(input, req.file.buffer);
    const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,58,&H00FFFFFF,&H0000FFFF,&H00000000,&H99000000,1,0,1,3,1,2,70,70,150,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
    const events = safeCues.map(c => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${assText(c.text)}`).join("\n");
    fs.writeFileSync(ass, header + events + "\n", "utf8");
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, ["-y", "-i", input, "-vf", `subtitles=${ass}`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output]);
      let err = ""; proc.stderr.on("data", chunk => { err += chunk.toString(); });
      proc.on("error", reject); proc.on("close", code => code === 0 ? resolve() : reject(new Error(err.slice(-1600) || "MP4 rendering failed")));
    });
    res.download(output, "autocap-captioned.mp4", () => fs.rmSync(temp, { recursive: true, force: true }));
  } catch (error) {
    console.error("MP4 export error:", error);
    fs.rmSync(temp, { recursive: true, force: true });
    res.status(500).json({ error: "MP4 export failed: " + (error.message || "Please try a shorter video.") });
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`AutoCap running on port ${port}`));
