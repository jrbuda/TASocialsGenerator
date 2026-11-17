/**
 * The Archives | Graphic Generator
 * Drop-in replacement for app.js. Works with the existing index.html and styles.css.
 * Template: template.svg (Affinity export with three 1024 x 1024 artboards).
 */
import { Canvg } from "https://cdn.jsdelivr.net/npm/canvg@4.0.3/+esm";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const FONT_FAMILY = '"Bebas Neue"';
const TEMPLATE_URL = "./template.svg";
const LOGO_PROXY = "./logo-proxy/";
const SIZE = 1024;

const ARTBOARDS = Object.freeze({
  matchup: { x: 0, filename: "matchup" },
  spoiler: { x: 1074, filename: "spoiler-warning" },
  results: { x: 2148, filename: "results" }
});

const HOTSPOTS = Object.freeze({
  matchup: [
    { type: "logo", team: 1, label: "Change Team 1 logo", x: 42, y: 272, w: 341, h: 342 },
    { type: "logo", team: 2, label: "Change Team 2 logo", x: 643, y: 272, w: 341, h: 342 },
    { type: "text", field: "team1Name", label: "Edit Team 1 name", x: 12, y: 614, w: 405, h: 125 },
    { type: "text", field: "team2Name", label: "Edit Team 2 name", x: 609, y: 614, w: 405, h: 125 },
    { type: "text", field: "division", label: "Edit division", x: 639, y: 103, w: 355, h: 124 },
    { type: "text", field: "stageText", label: "Edit stage text", x: 85, y: 845, w: 855, h: 135 }
  ],
  spoiler: [
    { type: "text", field: "division", label: "Edit division", x: 639, y: 103, w: 355, h: 124 },
    { type: "text", field: "stageText", label: "Edit stage text", x: 85, y: 845, w: 855, h: 135 }
  ],
  results: [
    { type: "logo", team: "winner", label: "Change winning team logo", x: 341, y: 275, w: 342, h: 340 },
    { type: "text", field: "winnerName", label: "Edit winning team name", x: 286, y: 612, w: 451, h: 135 },
    { type: "score", label: "Edit final scores", x: 260, y: 760, w: 506, h: 230 },
    { type: "text", field: "division", label: "Edit division", x: 639, y: 103, w: 355, h: 124 }
  ]
});

const $ = id => document.getElementById(id);
const filePromises = new WeakMap();
const urlPromises = new Map();
const droppedFiles = new Map();

let templateSource = "";
let activeArtboard = "matchup";
let editingFields = [];
let previewTimer = 0;
let previewRequest = 0;
let exportBusy = false;
let ready = false;

function setStatus(message, isError = false) {
  const element = $("status");
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function requireElement(id) {
  const element = $(id);
  if (!element) throw new Error(`Missing HTML element #${id}. Keep the existing index.html.`);
  return element;
}

function readFile(file) {
  if (filePromises.has(file)) return filePromises.get(file);
  const result = new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Unable to read ${file.name || "the logo"}.`));
    reader.readAsDataURL(file);
  });
  filePromises.set(file, result);
  return result;
}

function isImageFile(file) {
  return Boolean(file && (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name)));
}

function makeProxyUrl(url) {
  try {
    const original = new URL(url, location.href);
    if (!["https:", "http:"].includes(original.protocol)) return null;
    // This exact path is expected by the already-deployed allowlisted proxy.
    // The application does not provide a server-side proxy itself.
    return new URL(LOGO_PROXY + original.host + original.pathname + original.search, location.href).href;
  } catch {
    return null;
  }
}

async function fetchLogo(url, displayedUrl) {
  let response;
  try {
    response = await fetch(url, { mode: "cors" });
  } catch {
    throw new Error(`Cannot fetch logo from ${displayedUrl} (possibly CORS).`);
  }
  if (!response.ok) throw new Error(`Logo request returned HTTP ${response.status}: ${displayedUrl}`);
  const blob = await response.blob();
  if (!blob.type.toLowerCase().startsWith("image/")) {
    throw new Error(`The logo URL returned ${blob.type || "an unknown content type"}, not an image.`);
  }
  return readFile(new File([blob], "downloaded-logo", { type: blob.type }));
}

async function logoFromUrl(url) {
  if (urlPromises.has(url)) return urlPromises.get(url);
  const pending = (async () => {
    try {
      return await fetchLogo(url, url);
    } catch (directError) {
      const proxyUrl = makeProxyUrl(url);
      if (!proxyUrl) throw directError;
      try {
        return await fetchLogo(proxyUrl, url);
      } catch (proxyError) {
        if (/HTTP 403/.test(proxyError.message)) {
          const host = new URL(url, location.href).host;
          throw new Error(`The logo host ${host} is not allowed by this site's proxy. Upload the image instead.`);
        }
        throw new Error(`${directError.message} Proxy retry failed: ${proxyError.message}`);
      }
    }
  })();
  urlPromises.set(url, pending);
  try {
    return await pending;
  } catch (error) {
    urlPromises.delete(url);
    throw error;
  }
}

async function getTeamLogo(index) {
  const dropped = droppedFiles.get(index);
  const chosen = requireElement(`team${index}LogoFile`).files?.[0];
  const url = requireElement(`team${index}LogoUrl`).value.trim();
  const file = dropped || chosen;
  if (file) return readFile(file);
  if (url) return logoFromUrl(url);
  return null; // Keep the original logo from the Affinity template.
}

async function collectData() {
  const score1Raw = requireElement("team1Score").value.trim();
  const score2Raw = requireElement("team2Score").value.trim();
  const score1 = Number(score1Raw);
  const score2 = Number(score2Raw);
  if (!score1Raw || !score2Raw || ![score1, score2].every(n => Number.isSafeInteger(n) && n >= 0)) {
    throw new Error("Both scores must be non-negative whole numbers.");
  }
  const [logo1, logo2] = await Promise.all([getTeamLogo(1), getTeamLogo(2)]);
  return {
    division: requireElement("division").value.trim() || "DIVISION",
    stageText: requireElement("stageText").value.trim() || "Swiss Stage",
    team1: { name: requireElement("team1Name").value.trim() || "TEAM 1", score: score1, logo: logo1 },
    team2: { name: requireElement("team2Name").value.trim() || "TEAM 2", score: score2, logo: logo2 }
  };
}

function parseSvg() {
  const documentSvg = new DOMParser().parseFromString(templateSource, "image/svg+xml");
  if (documentSvg.querySelector("parsererror")) throw new Error("template.svg is not valid SVG.");
  return documentSvg;
}

function getSvgGroup(svg, id) {
  const group = svg.getElementById(id);
  if (!group) throw new Error(`Could not find SVG layer ${id}. Check template.svg.`);
  return group;
}

function getSvgText(svg, id) {
  const text = getSvgGroup(svg, id).querySelector("text");
  if (!text) throw new Error(`SVG layer ${id} has no text element.`);
  return text;
}

// Coordinates are transformed through ALL Affinity parent groups. Never use
// the original text x coordinate as though it were an artboard coordinate.
function transformToRoot(element) {
  const parts = [];
  for (let node = element; node?.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
    const transform = node.getAttribute("transform");
    if (transform) parts.unshift(new DOMMatrix(transform));
  }
  return parts.reduce((matrix, part) => matrix.multiply(part), new DOMMatrix());
}

function globalLogoCentre(svg, groupId) {
  const group = getSvgGroup(svg, groupId);
  const slot = group.querySelector("use, image");
  if (!slot) throw new Error(`No logo image found in ${groupId}.`);
  const x = parseFloat(slot.getAttribute("x") || "0");
  const y = parseFloat(slot.getAttribute("y") || "0");
  const width = parseFloat(slot.getAttribute("width") || "512");
  const height = parseFloat(slot.getAttribute("height") || "512");
  return transformToRoot(group).transformPoint({ x: x + width / 2, y: y + height / 2 }).x;
}

function putLogo(svg, groupId, imageData) {
  if (!imageData) return;
  const group = getSvgGroup(svg, groupId);
  const old = group.querySelector("use, image");
  if (!old) throw new Error(`No logo image found in ${groupId}.`);
  const image = svg.createElementNS(SVG_NS, "image");
  for (const name of ["x", "y", "width", "height"]) {
    const fallback = name === "width" || name === "height" ? "512px" : "0";
    image.setAttribute(name, old.getAttribute(name) || fallback);
  }
  image.setAttribute("preserveAspectRatio", "xMidYMid meet");
  image.setAttribute("href", imageData);
  image.setAttributeNS(XLINK_NS, "xlink:href", imageData);
  old.replaceWith(image);
}

// Font measurements must use the same Bebas Neue face that canvg renders.
function textWidth(text, fontSize) {
  const canvas = textWidth.canvas || (textWidth.canvas = document.createElement("canvas"));
  const ctx = canvas.getContext("2d");
  ctx.font = `${fontSize}px ${FONT_FAMILY}`;
  return ctx.measureText(text).width;
}

function splitTeamName(value) {
  const text = String(value).trim().replace(/\s+/g, " ");
  const characters = Array.from(text);
  if (characters.length <= 18) return [text];
  const words = text.split(" ");
  if (words.length === 1) {
    const midpoint = Math.ceil(characters.length / 2);
    return [characters.slice(0, midpoint).join(""), characters.slice(midpoint).join("")];
  }
  let bestLines = [text];
  let bestPenalty = Infinity;
  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i).join(" ");
    const right = words.slice(i).join(" ");
    const leftLength = Array.from(left).length;
    const rightLength = Array.from(right).length;
    const penalty = Math.abs(leftLength - rightLength) + 2 * (
      Math.max(0, leftLength - 18) + Math.max(0, rightLength - 18)
    );
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestLines = [left, right];
    }
  }
  return bestLines;
}

/**
 * Centre text in GLOBAL artboard coordinates, despite Affinity group transforms.
 * Build explicitly positioned SVG tspans so each line is centred independently.
 */
function centreText(text, newValue, globalX, maxWidth, wrapTeamName = false) {
  const lines = wrapTeamName ? splitTeamName(newValue) : [String(newValue)];
  const matrix = transformToRoot(text.parentElement);
  const scale = Math.hypot(matrix.a, matrix.b) || 1;
  const allowedLocalWidth = maxWidth / scale;
  const defaultFontSize = parseFloat(text.style.fontSize) || 54.167;
  const longest = Math.max(1, ...lines.map(line => textWidth(line, defaultFontSize)));
  const fontSize = longest > allowedLocalWidth
    ? Math.max(10, defaultFontSize * allowedLocalWidth / longest)
    : defaultFontSize;
  const centreLocalX = matrix.inverse().transformPoint({ x: globalX, y: 0 }).x;
  const baselineY = parseFloat(text.getAttribute("y") || "0");

  text.style.fontFamily = `${FONT_FAMILY}, sans-serif`;
  text.style.fontSize = `${fontSize}px`;
  text.setAttribute("text-anchor", "start");
  text.style.textAnchor = "start";
  text.setAttribute("x", "0");
  text.textContent = "";

  lines.forEach((line, index) => {
    const tspan = text.ownerDocument.createElementNS(SVG_NS, "tspan");
    tspan.setAttribute("x", `${centreLocalX - textWidth(line, fontSize) / 2}px`);
    // For two-line names, keep the top baseline at the original line and add
    // a second line beneath it, without overlapping the logo above.
    const y = baselineY + (lines.length > 1 ? index * fontSize * 0.9 : 0);
    tspan.setAttribute("y", `${y}px`);
    tspan.textContent = line;
    text.appendChild(tspan);
  });
}

function normaliseFont(svg) {
  for (const text of svg.querySelectorAll("text")) {
    text.style.fontFamily = `${FONT_FAMILY}, sans-serif`;
  }
}

function setTeamName(svg, nameGroup, logoGroup, name) {
  centreText(getSvgText(svg, nameGroup), name.toUpperCase(), globalLogoCentre(svg, logoGroup), 405, true);
}

function setDivision(svg, artboard, division) {
  const id = { matchup: "DIVISION5", spoiler: "DIVISION3", results: "DIVISION1" }[artboard];
  centreText(getSvgText(svg, id), division.toUpperCase(), ARTBOARDS[artboard].x + 822, 280);
}

function setStage(svg, artboard, stageLabel) {
  const id = { matchup: "SERIES-INFO1", spoiler: "SERIES-INFO" }[artboard];
  if (!id) return; // The results graphic has no stage label.
  const group = getSvgGroup(svg, id);
  const label = [...group.querySelectorAll("text")].find(text =>
    text.textContent.trim().toLowerCase() === "swiss stage"
  );
  if (!label) throw new Error(`No stage label found in SVG layer ${id}.`);
  centreText(label, stageLabel, ARTBOARDS[artboard].x + SIZE / 2, 880);
}

function setMatchup(svg, data) {
  putLogo(svg, "AEON_Forge.png1", data.team1.logo);
  putLogo(svg, "AEON_Aether.png", data.team2.logo);
  setTeamName(svg, "left-team-name1", "AEON_Forge.png1", data.team1.name);
  setTeamName(svg, "right-team-name", "AEON_Aether.png", data.team2.name);
  setDivision(svg, "matchup", data.division);
  setStage(svg, "matchup", data.stageText);
}

function setSpoiler(svg, data) {
  setDivision(svg, "spoiler", data.division);
  setStage(svg, "spoiler", data.stageText);
}

function setResults(svg, data) {
  if (data.team1.score === data.team2.score) {
    throw new Error("Results require a winner. Change the scores so they aren't tied.");
  }
  const winner = data.team1.score > data.team2.score ? data.team1 : data.team2;
  const loser = winner === data.team1 ? data.team2 : data.team1;
  putLogo(svg, "AEON_Forge.png", winner.logo);
  setTeamName(svg, "left-team-name", "AEON_Forge.png", winner.name);
  setDivision(svg, "results", data.division);
  const resultText = [...svg.querySelectorAll("text")].find(text =>
    Math.abs(parseFloat(text.style.fontSize) - 300) < 0.001
  );
  if (!resultText) throw new Error("Could not locate the gold results score in template.svg.");
  centreText(resultText, `${winner.score}-${loser.score}`, ARTBOARDS.results.x + SIZE / 2, 500);
}

function makeSvg(data, artboard) {
  if (!ARTBOARDS[artboard]) throw new Error(`Unknown artboard: ${artboard}`);
  const svg = parseSvg();
  normaliseFont(svg);
  if (artboard === "matchup") setMatchup(svg, data);
  if (artboard === "spoiler") setSpoiler(svg, data);
  if (artboard === "results") setResults(svg, data);
  const root = svg.documentElement;
  root.setAttribute("viewBox", `${ARTBOARDS[artboard].x} 0 ${SIZE} ${SIZE}`);
  root.setAttribute("width", String(SIZE));
  root.setAttribute("height", String(SIZE));
  root.setAttribute("preserveAspectRatio", "xMidYMid meet");
  return new XMLSerializer().serializeToString(svg);
}

function newCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  return canvas;
}

async function renderSvg(svg, canvas) {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("Canvas rendering is unavailable in this browser.");
  ctx.clearRect(0, 0, SIZE, SIZE);
  const renderer = Canvg.fromString(ctx, svg);
  try {
    await renderer.render();
  } finally {
    renderer.stop();
  }
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG encoding failed.")), "image/png");
  });
}

async function graphicPng(data, artboard) {
  const canvas = newCanvas();
  await renderSvg(makeSvg(data, artboard), canvas);
  return canvasBlob(canvas);
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function safeFilename(text) {
  return String(text).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 45) || "team";
}

function filenamePrefix(data) {
  return `${safeFilename(data.team1.name)}_vs_${safeFilename(data.team2.name)}`;
}

function winnerIndex() {
  const left = Number(requireElement("team1Score").value);
  const right = Number(requireElement("team2Score").value);
  return left >= right ? 1 : 2;
}

function closeEditor() {
  requireElement("editPopover").hidden = true;
  requireElement("popoverInputs").replaceChildren();
  editingFields = [];
}

function openEditor(fields) {
  if (exportBusy) return;
  closeEditor();
  editingFields = fields;
  const host = requireElement("popoverInputs");
  const labels = {
    team1Name: "Team 1 name", team2Name: "Team 2 name", division: "Division",
    stageText: "Stage text", team1Score: "Team 1 score", team2Score: "Team 2 score"
  };
  fields.forEach(id => {
    const original = requireElement(id);
    const label = document.createElement("label");
    label.htmlFor = `popup-${id}`;
    label.textContent = labels[id] || id;
    const input = document.createElement("input");
    input.id = `popup-${id}`;
    input.type = original.type === "number" ? "number" : "text";
    if (input.type === "number") {
      input.min = "0";
      input.step = "1";
    }
    input.value = original.value;
    host.append(label, input);
  });
  requireElement("editPopover").hidden = false;
  const first = host.querySelector("input");
  first?.focus();
  first?.select();
}

function saveEditor(event) {
  event.preventDefault();
  const values = editingFields.map(id => ({ id, value: requireElement(`popup-${id}`).value }));
  for (const { id, value } of values) {
    if (id.endsWith("Score") && (!value.trim() || !Number.isSafeInteger(Number(value)) || Number(value) < 0)) {
      setStatus("Scores must be non-negative whole numbers.", true);
      return;
    }
  }
  for (const { id, value } of values) requireElement(id).value = value;
  closeEditor();
  schedulePreview();
}

function positionHotspot(button, spot) {
  button.style.left = `${spot.x / SIZE * 100}%`;
  button.style.top = `${spot.y / SIZE * 100}%`;
  button.style.width = `${spot.w / SIZE * 100}%`;
  button.style.height = `${spot.h / SIZE * 100}%`;
}

function assignedTeam(spot) {
  return spot.team === "winner" ? winnerIndex() : spot.team;
}

function assignLogoFile(team, file) {
  if (!isImageFile(file)) throw new Error("Please drop a PNG, JPG, WebP, GIF, or SVG image.");
  droppedFiles.set(team, file);
  const picker = requireElement(`team${team}LogoFile`);
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    picker.files = transfer.files;
  } catch {
    // The dropped-file map is the cross-browser fallback when FileList is read-only.
  }
  requireElement(`team${team}LogoUrl`).value = "";
  setStatus(`${file.name} assigned to Team ${team}.`);
  schedulePreview();
}

function assignLogoUrl(team, value) {
  const url = String(value || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("Drop an image file or a direct http(s) image URL.");
  droppedFiles.delete(team);
  requireElement(`team${team}LogoFile`).value = "";
  requireElement(`team${team}LogoUrl`).value = url;
  schedulePreview();
}

function droppedImageUrl(dataTransfer) {
  const html = dataTransfer.getData("text/html");
  if (html) {
    const image = new DOMParser().parseFromString(html, "text/html").querySelector("img[src]");
    if (image?.src) return image.src;
  }
  const uri = dataTransfer.getData("text/uri-list").split("\n").find(item => item.trim() && !item.startsWith("#"));
  return uri || dataTransfer.getData("text/plain");
}

function installLogoDrop(button, spot) {
  button.addEventListener("dragover", event => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    button.classList.add("dragging");
  });
  button.addEventListener("dragleave", event => {
    if (!button.contains(event.relatedTarget)) button.classList.remove("dragging");
  });
  button.addEventListener("drop", event => {
    event.preventDefault();
    event.stopPropagation();
    button.classList.remove("dragging");
    if (exportBusy) return;
    try {
      const team = assignedTeam(spot);
      const file = [...(event.dataTransfer?.files || [])].find(isImageFile);
      if (file) assignLogoFile(team, file);
      else assignLogoUrl(team, droppedImageUrl(event.dataTransfer));
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

function rebuildHotspots() {
  const host = requireElement("previewHotspots");
  host.replaceChildren();
  HOTSPOTS[activeArtboard].forEach(spot => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `preview-hotspot ${spot.type === "logo" ? "dropzone" : spot.type === "score" ? "scorezone" : "editzone"}`;
    button.setAttribute("aria-label", spot.label);
    button.title = spot.type === "logo" ? `${spot.label} (click or drop an image)` : spot.label;
    positionHotspot(button, spot);
    button.addEventListener("click", () => {
      if (exportBusy) return;
      if (spot.type === "logo") {
        requireElement(`team${assignedTeam(spot)}LogoFile`).click();
      } else if (spot.type === "score") {
        openEditor(["team1Score", "team2Score"]);
      } else {
        const nameField = spot.field === "winnerName" ? `team${winnerIndex()}Name` : spot.field;
        openEditor([nameField]);
      }
    });
    if (spot.type === "logo") installLogoDrop(button, spot);
    host.appendChild(button);
  });
}

function selectPreview(artboard) {
  if (!ARTBOARDS[artboard] || exportBusy) return;
  activeArtboard = artboard;
  closeEditor();
  document.querySelectorAll("[data-preview]").forEach(button => {
    const selected = button.dataset.preview === artboard;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  rebuildHotspots();
  schedulePreview(0);
}

async function refreshPreview() {
  if (!ready || exportBusy) return;
  const request = ++previewRequest;
  try {
    setStatus("Rendering preview…");
    const artboard = activeArtboard;
    const data = await collectData();
    if (request !== previewRequest) return;
    const canvas = newCanvas();
    await renderSvg(makeSvg(data, artboard), canvas);
    if (request !== previewRequest) return;
    const visible = requireElement("previewCanvas").getContext("2d");
    visible.clearRect(0, 0, SIZE, SIZE);
    visible.drawImage(canvas, 0, 0);
    setStatus("Preview ready · 1024 × 1024");
  } catch (error) {
    console.error(error);
    if (request === previewRequest) setStatus(error.message, true);
  }
}

function schedulePreview(delay = 300) {
  ++previewRequest; // Invalidate any older in-progress preview immediately.
  clearTimeout(previewTimer);
  if (ready && !exportBusy) previewTimer = setTimeout(refreshPreview, delay);
}

async function whileExporting(work) {
  if (exportBusy || !ready) return;
  exportBusy = true;
  clearTimeout(previewTimer);
  ++previewRequest;
  const buttons = document.querySelectorAll(".button-grid button, .preview-tabs button");
  buttons.forEach(button => { button.disabled = true; });
  try {
    await work();
  } catch (error) {
    console.error(error);
    setStatus(error.message, true);
    alert(error.message);
  } finally {
    buttons.forEach(button => { button.disabled = false; });
    exportBusy = false;
    schedulePreview(100);
  }
}

async function exportGraphic(artboard) {
  await whileExporting(async () => {
    const data = await collectData();
    setStatus(`Exporting ${artboard}…`);
    const blob = await graphicPng(data, artboard);
    saveBlob(blob, `${filenamePrefix(data)}_${ARTBOARDS[artboard].filename}.png`);
    setStatus("PNG exported.");
  });
}

async function exportZip() {
  await whileExporting(async () => {
    if (!window.JSZip) throw new Error("JSZip did not load. Check the script in index.html.");
    const data = await collectData();
    if (data.team1.score === data.team2.score) {
      throw new Error("A winner is needed to export results. Change the tied scores first.");
    }
    const zip = new window.JSZip();
    for (const key of ["matchup", "spoiler", "results"]) {
      setStatus(`Rendering ${key}…`);
      zip.file(`${filenamePrefix(data)}_${ARTBOARDS[key].filename}.png`, await graphicPng(data, key));
    }
    setStatus("Creating ZIP…");
    saveBlob(await zip.generateAsync({ type: "blob" }), `${filenamePrefix(data)}_graphics.zip`);
    setStatus("ZIP exported.");
  });
}

function bindEvents() {
  requireElement("exportMatchupBtn").addEventListener("click", () => exportGraphic("matchup"));
  requireElement("exportSpoilerBtn").addEventListener("click", () => exportGraphic("spoiler"));
  requireElement("exportResultsBtn").addEventListener("click", () => exportGraphic("results"));
  requireElement("exportAllBtn").addEventListener("click", exportZip);
  requireElement("editPopover").addEventListener("submit", saveEditor);
  requireElement("popoverCancel").addEventListener("click", closeEditor);
  requireElement("editPopover").addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); closeEditor(); }
  });
  document.querySelectorAll("[data-preview]").forEach(button => {
    button.addEventListener("click", () => selectPreview(button.dataset.preview));
  });
  // Only bind the sidebar inputs. The inline editor has its own Apply action.
  document.querySelectorAll("aside input").forEach(input => {
    input.addEventListener("input", () => {
      if (/^team[12]LogoUrl$/.test(input.id)) {
        const team = Number(input.id[4]);
        droppedFiles.delete(team);
        requireElement(`team${team}LogoFile`).value = "";
      }
      schedulePreview();
    });
    input.addEventListener("change", () => {
      if (/^team[12]LogoFile$/.test(input.id)) {
        const team = Number(input.id[4]);
        droppedFiles.delete(team);
        if (input.files?.length) requireElement(`team${team}LogoUrl`).value = "";
      }
      schedulePreview();
    });
  });
  // Prevent dropping a file outside a logo hotspot from navigating away.
  document.addEventListener("dragover", event => {
    if ([...(event.dataTransfer?.types || [])].includes("Files")) event.preventDefault();
  });
  document.addEventListener("drop", event => {
    if ([...(event.dataTransfer?.types || [])].includes("Files")) event.preventDefault();
  });
}

async function init() {
  try {
    bindEvents();
    rebuildHotspots();
    setStatus("Loading template…");
    const response = await fetch(TEMPLATE_URL);
    if (!response.ok) throw new Error(`Cannot load template.svg (HTTP ${response.status}). Serve the files over HTTP(S).`);
    templateSource = await response.text();
    if (!templateSource.includes("MATCHUP-SCREEN")) {
      throw new Error("template.svg does not appear to be The Archives Affinity template.");
    }
    setStatus("Loading Bebas Neue…");
    await Promise.all([
      document.fonts.load('54.167px "Bebas Neue"'),
      document.fonts.load('83.333px "Bebas Neue"'),
      document.fonts.load('300px "Bebas Neue"')
    ]);
    await document.fonts.ready;
    if (!document.fonts.check('54.167px "Bebas Neue"')) {
      throw new Error("Bebas Neue could not be loaded. Check Google Fonts access.");
    }
    ready = true;
    await refreshPreview();
  } catch (error) {
    console.error(error);
    setStatus(error.message, true);
  }
}

init();
