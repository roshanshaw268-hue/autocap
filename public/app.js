const $ = id => document.getElementById(id);

const state = {
  file: null,
  mode: "auto",
  segments: [],
  color: "#ffffff"
};

const mediaInput = $("mediaInput");
const video = $("videoPreview");
const overlay = $("captionOverlay");

const fmt = n => {
  n = Math.max(0, Number(n) || 0);
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
};

const stamp = (n, comma = true) => {
  const ms = Math.round((Number(n) || 0) * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms % 3600000 / 60000);
  const s = Math.floor(ms % 60000 / 1000);
  const x = ms % 1000;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${comma ? "," : "."}${String(x).padStart(3, "0")}`;
};

function setFile(file) {
  if (!file) return;

  state.file = file;

  $("fileName").textContent = file.name;
  $("fileSize").textContent = (file.size / 1024 / 1024).toFixed(2) + " MB";

  $("fileInfo").classList.remove("hidden");
  $("dropzone").classList.add("hidden");
  $("placeholder").classList.add("hidden");

  if (file.type.startsWith("video/")) {
    video.src = URL.createObjectURL(file);
    video.classList.remove("hidden");
  } else {
    video.classList.add("hidden");
    $("placeholder").classList.remove("hidden");
    $("placeholder").querySelector("b").textContent = "Audio ready";
    $("placeholder").querySelector("span").textContent = "Generate captions to preview your transcript";
  }
}

mediaInput.addEventListener("change", e => setFile(e.target.files[0]));

$("removeFile").onclick = () => {
  state.file = null;
  mediaInput.value = "";

  $("fileInfo").classList.add("hidden");
  $("dropzone").classList.remove("hidden");

  video.pause();
  video.removeAttribute("src");
  video.classList.add("hidden");

  $("placeholder").classList.remove("hidden");
  $("placeholder").querySelector("b").textContent = "Your preview lives here";
  $("placeholder").querySelector("span").textContent = "Upload a video to see your captions in action";
};

const dz = $("dropzone");

["dragenter", "dragover"].forEach(ev => {
  dz.addEventListener(ev, e => {
    e.preventDefault();
    dz.classList.add("drag");
  });
});

["dragleave", "drop"].forEach(ev => {
  dz.addEventListener(ev, e => {
    e.preventDefault();
    dz.classList.remove("drag");
  });
});

dz.addEventListener("drop", e => setFile(e.dataTransfer.files[0]));

$("autoMode").onclick = () => {
  state.mode = "auto";
  $("autoMode").classList.add("active");
  $("manualMode").classList.remove("active");
  $("modeNote").textContent = "AI transcription uses your configured Groq API key. Manual editing is always free.";
};

$("manualMode").onclick = () => {
  state.mode = "manual";
  $("manualMode").classList.add("active");
  $("autoMode").classList.remove("active");
  $("modeNote").textContent = "Manual mode creates editable caption lines without calling AI.";
};

$("generateBtn").onclick = async () => {
  hideError();

  if (state.mode === "manual") {
    if (!state.file && !state.segments.length) {
      addSegment(0, 3, "Type your first caption here…");
    }

    $("editorSection").classList.remove("hidden");
    renderSegments();
    $("editorSection").scrollIntoView({ behavior: "smooth" });
    return;
  }

  if (!state.file) {
    showError("Please upload a video or audio file first.");
    return;
  }

  const btn = $("generateBtn");
  btn.disabled = true;

  $("progressWrap").classList.remove("hidden");
  $("progressText").textContent = "Extracting audio and listening for speech…";

  try {
    const fd = new FormData();

    fd.append("media", state.file);
    fd.append("language", $("language").value);

    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: fd
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not generate captions.");
    }

    state.segments = (data.segments || []).map((s, i) => ({
      ...s,
      id: i + 1
    }));

    if (!state.segments.length && data.text) {
      state.segments = [{
        id: 1,
        start: 0,
        end: Math.max(3, video.duration || 3),
        text: data.text
      }];
    }

    if (!state.segments.length) {
      throw new Error("No speech segments were detected. Try another language or file.");
    }

    $("editorSection").classList.remove("hidden");

    renderSegments();
    updateOverlay();

    $("editorSection").scrollIntoView({ behavior: "smooth" });

  } catch (e) {
    showError(e.message);
  } finally {
    btn.disabled = false;
    $("progressWrap").classList.add("hidden");
  }
};

function showError(msg) {
  $("errorBox").textContent = msg;
  $("errorBox").classList.remove("hidden");
}

function hideError() {
  $("errorBox").classList.add("hidden");
}

function addSegment(start = 0, end = 2, text = "New caption…") {
  state.segments.push({
    id: Date.now() + Math.random(),
    start,
    end,
    text
  });

  renderSegments();
  updateOverlay();
}

$("addSegment").onclick = () => {
  const start = state.segments.length
    ? state.segments.at(-1).end
    : 0;

  addSegment(start, start + 3, "New caption…");
};

function renderSegments() {
  const root = $("segments");
  root.innerHTML = "";

  state.segments.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "segment";

    const time = document.createElement("input");
    time.className = "time";
    time.value = fmt(s.start);
    time.title = "Start time in seconds";

    time.addEventListener("change", () => {
      const v = time.value.includes(":")
        ? time.value.split(":").reduce((a, x) => a * 60 + Number(x), 0)
        : Number(time.value);

      if (Number.isFinite(v)) {
        s.start = Math.max(0, v);
      }

      updateOverlay();
    });

    const txt = document.createElement("input");
    txt.value = s.text;
    txt.setAttribute("aria-label", "Caption text");

    txt.addEventListener("input", () => {
      s.text = txt.value;
      updateOverlay();
    });

    const del = document.createElement("button");
    del.textContent = "×";
    del.title = "Delete caption";

    del.onclick = () => {
      state.segments.splice(i, 1);
      renderSegments();
      updateOverlay();
    };

    row.append(time, txt, del);
    root.append(row);
  });

  $("segmentCount").textContent =
    `${state.segments.length} caption segment${state.segments.length === 1 ? "" : "s"}`;
}

function updateOverlay() {
  const t = video.currentTime || 0;

  const current = state.segments.find(
    s => t >= s.start && t <= s.end
  ) || state.segments[0];

  overlay.textContent = current
    ? current.text
    : "Your captions will appear here.";
}

video.addEventListener("timeupdate", () => {
  $("previewTime").textContent =
    `${fmt(video.currentTime)} / ${fmt(video.duration || 0)}`;

  updateOverlay();
});

function style() {
  overlay.style.fontFamily = $("fontSelect").value;
  overlay.style.fontSize = $("fontSize").value + "px";
  overlay.style.color = state.color;

  overlay.style.background =
    `rgba(0,0,0,${Number($("bgOpacity").value) / 100})`;

  overlay.style.top =
    $("position").value === "top" ? "35px" :
    $("position").value === "middle" ? "50%" : "auto";

  overlay.style.bottom =
    $("position").value === "bottom" ? "42px" : "auto";

  overlay.style.transform =
    $("position").value === "middle"
      ? "translateY(-50%)"
      : "none";

  $("fontSizeValue").textContent = $("fontSize").value + "px";
  $("opacityValue").textContent = $("bgOpacity").value + "%";
}

["fontSelect", "fontSize", "bgOpacity", "position"].forEach(id => {
  $(id).addEventListener("input", style);
});

document.querySelectorAll(".swatch").forEach(b => {
  b.onclick = () => {
    document.querySelectorAll(".swatch").forEach(x => {
      x.classList.remove("selected");
    });

    b.classList.add("selected");
    state.color = b.dataset.color;
    style();
  };
});

style();

function download(name, content, type) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(
    new Blob([content], { type })
  );

  a.href = url;
  a.download = name;
  a.click();

  URL.revokeObjectURL(url);
}

function safeName() {
  return (state.file?.name || "autocap")
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w-]+/g, "-");
}

$("srtBtn").onclick = () => {
  if (!state.segments.length) {
    return showError("Generate or add captions first.");
  }

  download(
    safeName() + ".srt",
    state.segments.map((s, i) =>
      `${i + 1}\n${stamp(s.start)} --> ${stamp(s.end)}\n${s.text}`
    ).join("\n\n"),
    "text/plain"
  );
};

$("vttBtn").onclick = () => {
  if (!state.segments.length) {
    return showError("Generate or add captions first.");
  }

  download(
    safeName() + ".vtt",
    "WEBVTT\n\n" +
    state.segments.map(s =>
      `${stamp(s.start, false)} --> ${stamp(s.end, false)}\n${s.text}`
    ).join("\n\n"),
    "text/vtt"
  );
};

$("txtBtn").onclick = () => {
  if (!state.segments.length) {
    return showError("Generate or add captions first.");
  }

  download(
    safeName() + ".txt",
    state.segments.map(s => s.text).join("\n"),
    "text/plain"
  );
};

fetch("/api/health")
  .then(r => r.json())
  .then(d => {
    $("apiStatus").textContent =
      d.aiReady ? "AI engine ready" : "Manual mode ready";

    $("apiStatus").previousElementSibling.style.background =
      d.aiReady ? "#d9ff55" : "#ffbd59";
  })
  .catch(() => {
    $("apiStatus").textContent = "Offline";
  });
