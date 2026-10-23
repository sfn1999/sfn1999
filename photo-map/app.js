(function () {
  const SAMPLE_PATHS = [
    "samples/bund.jpg",
    "samples/west-lake.jpg",
    "samples/forbidden-city.jpg",
    "samples/terracotta.jpg",
    "samples/desk.jpg",
  ];

  const TITLE_KEYS = ["title", "XPTitle", "ObjectName", "Headline", "DocumentName"];
  const CAPTION_KEYS = [
    "description",
    "ImageDescription",
    "UserComment",
    "XPComment",
    "Caption",
    "Caption-Abstract",
    "Headline",
  ];

  const statusEl = document.querySelector("#status");
  const emptyEl = document.querySelector("#empty");
  const mapNoteEl = document.querySelector("#map-note");
  const dropEl = document.querySelector("#drop");
  const detailEmptyEl = document.querySelector("#detail-empty");
  const detailBodyEl = document.querySelector("#detail-body");
  const photoButton = document.querySelector("#photo-button");
  const detailImgEl = document.querySelector("#detail-img");
  const writeHintEl = document.querySelector("#write-hint");
  const detailSentenceEl = document.querySelector("#detail-sentence");
  const titleInput = document.querySelector("#title-input");
  const memoryText = document.querySelector("#memory-text");
  const placeBtn = document.querySelector("#place-btn");
  const restoreBtn = document.querySelector("#restore-btn");
  const saveStateEl = document.querySelector("#save-state");
  const deleteBtn = document.querySelector("#delete-btn");
  const detailFactsEl = document.querySelector("#detail-facts");
  const listEl = document.querySelector("#list");
  const countEl = document.querySelector("#count");
  const toastEl = document.querySelector("#toast");
  const clearBtn = document.querySelector("#clear");
  const samplesBtn = document.querySelector("#samples");
  const addBtn = document.querySelector("#add");
  const fileInput = document.querySelector("#file");
  const placeBanner = document.querySelector("#place-banner");
  const placeBannerText = document.querySelector("#place-banner-text");

  if (!window.L || !window.exifr) {
    statusEl.textContent = "地图组件没有加载完成。";
    return;
  }

  const map = L.map("map", { minZoom: 2, worldCopyJump: true }).setView([35.2, 104.5], 4);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: function (zoom) {
      return zoom < 8 ? 8 : 36;
    },
    spiderfyOnMaxZoom: true,
  });
  map.addLayer(cluster);
  cluster.on("animationend", updateMarkerSelection);

  const photos = [];
  const placeCache = new Map();
  const saveTimers = new Map();
  const saveGeneration = new Map();
  let selectedId = null;
  let detailBoundId = null;
  let placingId = null;
  let stickToPhotos = true;
  let dragDepth = 0;
  let toastTimer = 0;
  let clearArmed = false;
  let clearTimer = 0;
  let geoActive = 0;
  let toldPersistError = false;
  let saveChain = Promise.resolve();
  let storeEpoch = 0;
  const geoQueue = [];

  map.on("dragstart", function () {
    stickToPhotos = false;
  });
  map.on("zoomstart", function (event) {
    if (event.originalEvent) stickToPhotos = false;
  });
  map.on("click", function (event) {
    if (!placingId) return;
    const photo = findPhoto(placingId);
    if (!photo) {
      cancelPlacing();
      return;
    }
    photo.latitude = event.latlng.lat;
    photo.longitude = event.latlng.lng;
    photo.place = "";
    photo.placeStatus = "loading";
    photo.updatedAt = Date.now();
    moveMarker(photo);
    cancelPlacing();
    scheduleGeo(photo);
    persist(photo);
    render();
    focusPhoto(photo);
    showToast("已经放到地图上");
  });
  window.addEventListener("resize", function () {
    map.invalidateSize();
  });
  window.addEventListener("pagehide", flushPendingSaves);
  window.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (placingId) {
      event.preventDefault();
      cancelPlacing();
      renderDetail();
      return;
    }
    if (deleteBtn.dataset.armed === "1") {
      deleteBtn.dataset.armed = "";
      deleteBtn.textContent = "移除这张照片";
    }
    if (clearArmed) resetClear();
  });

  clearBtn.addEventListener("click", onClearClick);
  samplesBtn.addEventListener("click", function () {
    addQueue = addQueue.then(loadSamples);
  });
  addBtn.addEventListener("click", function () {
    fileInput.click();
  });
  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files.length) enqueueAdd(fileInput.files);
    fileInput.value = "";
  });
  photoButton.addEventListener("click", function () {
    memoryText.focus();
  });
  titleInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      memoryText.focus();
    }
  });
  titleInput.addEventListener("input", function () {
    const photo = currentPhoto();
    if (!photo) return;
    photo.title = titleInput.value;
    onTextEdited(photo);
  });
  memoryText.addEventListener("input", function () {
    const photo = currentPhoto();
    if (!photo) return;
    photo.memory = memoryText.value;
    autosize(memoryText);
    onTextEdited(photo);
  });
  placeBtn.addEventListener("click", function () {
    const photo = currentPhoto();
    if (!photo) return;
    if (placingId === photo.id) {
      cancelPlacing();
      renderDetail();
      return;
    }
    startPlacing(photo);
  });
  restoreBtn.addEventListener("click", restoreExif);
  deleteBtn.addEventListener("click", function () {
    const photo = currentPhoto();
    if (!photo) return;
    if (deleteBtn.dataset.armed !== "1") {
      deleteBtn.dataset.armed = "1";
      deleteBtn.textContent = "确认移除";
      return;
    }
    removePhoto(photo);
  });
  document.querySelector("#place-cancel").addEventListener("click", function () {
    cancelPlacing();
    renderDetail();
  });

  window.addEventListener("dragenter", function (event) {
    if (!eventHasFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    dropEl.hidden = false;
  });
  window.addEventListener("dragover", function (event) {
    if (!eventHasFiles(event)) return;
    event.preventDefault();
  });
  window.addEventListener("dragleave", function () {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropEl.hidden = true;
  });
  window.addEventListener("drop", function (event) {
    if (!eventHasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    dropEl.hidden = true;
    enqueueAdd(event.dataTransfer.files);
  });

  function enqueueAdd(fileList) {
    const files = Array.from(fileList);
    addQueue = addQueue.then(function () {
      return addFiles(files);
    });
    return addQueue;
  }

  async function boot() {
    try {
      const saved = await loadSaved();
      saved.forEach(function (photo) {
        photos.push(photo);
      });
      sortPhotos();
      photos.forEach(function (photo) {
        if (photo.latitude == null) return;
        addMarker(photo);
        if (!photo.place) scheduleGeo(photo);
      });
    } catch (error) {
      console.error(error);
      showToast("没能打开上次保存的照片。");
    }
    render();
    requestAnimationFrame(function () {
      map.invalidateSize();
      if (photos.some(function (photo) { return photo.latitude != null; })) fitToPhotos();
    });
  }

  async function loadSamples() {
    setBusy(true);
    try {
      const files = [];
      for (let index = 0; index < SAMPLE_PATHS.length; index += 1) {
        const path = SAMPLE_PATHS[index];
        const name = path.split("/").pop();
        if (photos.some(function (photo) { return photo.sample && photo.name === name; })) continue;
        const response = await fetch(path);
        if (!response.ok) throw new Error(path);
        const blob = await response.blob();
        files.push(new File([blob], name, { type: blob.type || "image/jpeg" }));
      }
      if (!files.length) {
        showToast("示例已经在相册里了。");
        return;
      }
      await addFiles(files, { sample: true, select: false });
    } catch (error) {
      console.error(error);
      showToast("示例照片没有打开。请在 photo-map 文件夹里启动网页服务后再试。");
    } finally {
      setBusy(false);
    }
  }

  async function addFiles(incoming, options) {
    const files = incoming.filter(isImage);
    const skipped = incoming.length - files.length;
    if (!files.length) {
      if (skipped) showToast("没有找到可以读取的图片。");
      return;
    }
    if (skipped) showToast("已跳过 " + skipped + " 个不是图片的文件。");

    setBusy(true);
    const opened = [];
    try {
      let addedGps = 0;
      for (let index = 0; index < files.length; index += 1) {
        statusEl.textContent = "正在读取 " + (index + 1) + " / " + files.length;
        let photo;
        try {
          photo = await readPhoto(files[index]);
        } catch (error) {
          console.error(error);
          showToast("没能读入 " + files[index].name);
          continue;
        }
        if (options && options.sample) photo.sample = true;
        photos.push(photo);
        opened.push(photo);
        emptyEl.hidden = true;
        mapNoteEl.hidden = true;
        if (photo.latitude != null) {
          addMarker(photo);
          scheduleGeo(photo);
          addedGps += 1;
        }
        renderList();
        persist(photo);
      }
      sortPhotos();
      renderList();
      const allowSelect = !(options && options.select === false);
      if (allowSelect && opened.length === 1) selectPhoto(opened[0].id, { source: "upload" });
      else if (allowSelect && !selectedId && opened.length) selectPhoto(opened[0].id, { source: "auto" });
      if (addedGps && stickToPhotos) fitToPhotos();
      map.invalidateSize();
    } finally {
      setBusy(false);
      render();
    }
  }

  async function readPhoto(file) {
    let gps = null;
    let meta = null;
    try {
      gps = await exifr.gps(file);
    } catch (error) {
      gps = null;
    }
    try {
      meta = await exifr.parse(file, {
        xmp: true,
        iptc: true,
        reviveValues: false,
        translateValues: false,
      });
    } catch (error) {
      meta = null;
    }

    const latitude = gps && Number.isFinite(gps.latitude) ? gps.latitude : null;
    const longitude = gps && Number.isFinite(gps.longitude) ? gps.longitude : null;
    const hasGps = latitude != null && longitude != null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && !(latitude === 0 && longitude === 0);
    const text = buildText(meta, file.name);
    const time = exifTime(meta);
    const imageUrl = URL.createObjectURL(file);
    const thumbBlob = await makeThumbBlob(file);
    const thumbUrl = thumbBlob ? URL.createObjectURL(thumbBlob) : imageUrl;
    const now = Date.now();

    return {
      id: createId(),
      name: file.name,
      sample: false,
      imageUrl: imageUrl,
      thumbUrl: thumbUrl,
      fileBlob: file,
      thumbBlob: thumbBlob,
      latitude: hasGps ? latitude : null,
      longitude: hasGps ? longitude : null,
      exifLat: hasGps ? latitude : null,
      exifLng: hasGps ? longitude : null,
      when: time.when,
      sort: time.sort,
      camera: formatCamera(meta),
      altitude: formatAltitude(meta),
      title: text.title,
      memory: text.caption,
      place: "",
      placeStatus: hasGps ? "loading" : "none",
      createdAt: now,
      updatedAt: now,
      marker: null,
    };
  }

  function createId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function buildText(meta, filename) {
    const titles = collectText(meta, TITLE_KEYS);
    const captions = collectText(meta, CAPTION_KEYS);
    const title = titles[0] || filename.replace(/\.[^.]+$/, "");
    const parts = [];
    titles.slice(1).concat(captions).forEach(function (part) {
      if (!part || part === title || parts.indexOf(part) !== -1) return;
      parts.push(part);
    });
    return { title: title, caption: parts.join("\n") };
  }

  function collectText(meta, keys) {
    if (!meta) return [];
    const found = [];
    keys.forEach(function (key) {
      const text = asText(meta[key], key);
      if (!usable(text) || found.indexOf(text) !== -1) return;
      found.push(text);
    });
    return found;
  }

  function asText(value, key) {
    if (value == null) return "";
    if (typeof value === "string") return clean(value);
    if (ArrayBuffer.isView(value)) {
      if (key && String(key).indexOf("XP") === 0) return clean(decodeUtf16le(bytesOf(value)));
      if (key === "UserComment") return clean(decodeUserComment(bytesOf(value)));
      return "";
    }
    if (Array.isArray(value)) {
      return value.map(function (item) { return asText(item, key); }).filter(Boolean).join("\n");
    }
    if (typeof value === "object") {
      if (typeof value.value === "string" || Array.isArray(value.value) || (value.value && typeof value.value === "object")) {
        return asText(value.value, key);
      }
      const preferred = value["x-default"] || value["zh-CN"] || value.zh || value["zh-Hans"];
      if (preferred) return asText(preferred, key);
    }
    return "";
  }

  function bytesOf(value) {
    if (value instanceof Uint8Array) return value;
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  function decodeUtf16le(bytes) {
    let end = bytes.length;
    while (end >= 2 && bytes[end - 1] === 0 && bytes[end - 2] === 0) end -= 2;
    return new TextDecoder("utf-16le").decode(bytes.subarray(0, end));
  }

  function decodeUserComment(bytes) {
    const header = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(8, bytes.length)));
    if (header.indexOf("UNICODE") === 0) return new TextDecoder("utf-16be").decode(bytes.subarray(8));
    if (header.indexOf("ASCII") === 0) return new TextDecoder("utf-8").decode(bytes.subarray(8));
    return new TextDecoder("utf-8").decode(bytes);
  }

  function clean(value) {
    return String(value).replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
  }

  function usable(text) {
    if (!text) return false;
    if (text.length > 2000) return false;
    if (/\uFFFD/.test(text)) return false;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdfff) return false;
      if (code < 32 && code !== 9 && code !== 10) return false;
    }
    return true;
  }

  function exifTime(meta) {
    if (!meta) return { when: "", sort: "" };
    const raw = meta.DateTimeOriginal || meta.CreateDate || meta.DateTimeDigitized || meta.DateTime;
    if (typeof raw !== "string") return { when: "", sort: "" };
    const match = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/);
    if (!match) return { when: "", sort: "" };
    return {
      when: match[1] + "年" + Number(match[2]) + "月" + Number(match[3]) + "日 " + match[4] + ":" + match[5],
      sort: match[1] + match[2] + match[3] + match[4] + match[5],
    };
  }

  function formatCamera(meta) {
    const make = asText(meta && meta.Make, "Make");
    const model = asText(meta && meta.Model, "Model");
    if (!usable(make) && !usable(model)) return "";
    if (usable(make) && usable(model) && model.indexOf(make) === 0) return model;
    return [usable(make) ? make : "", usable(model) ? model : ""].filter(Boolean).join(" ");
  }

  function formatAltitude(meta) {
    const value = meta && meta.GPSAltitude;
    if (typeof value !== "number" || !Number.isFinite(value)) return "";
    const ref = meta.GPSAltitudeRef;
    const below = ref === 1 || (ArrayBuffer.isView(ref) && ref[0] === 1);
    const rounded = Math.round(Math.abs(value));
    return (below ? "海平面以下 " : "") + rounded + " 米";
  }

  function formatCoord(lat, lon) {
    const ns = lat >= 0 ? "N" : "S";
    const ew = lon >= 0 ? "E" : "W";
    return Math.abs(lat).toFixed(5) + "° " + ns + "，" + Math.abs(lon).toFixed(5) + "° " + ew;
  }

  function shortPlace(place) {
    return place.replace(/^中华人民共和国/, "");
  }

  function displayTitle(photo) {
    const title = photo.title && photo.title.trim();
    return title || "未命名";
  }

  function locationSentence(photo) {
    if (photo.latitude == null) return "这张照片没有记录拍摄位置。点「在地图上选择位置」，再在地图上点一下。";
    const where = photo.place ? shortPlace(photo.place) : (photo.placeStatus === "loading" ? "" : formatCoord(photo.latitude, photo.longitude));
    const lead = photo.when ? photo.when + "，" : "";
    if (!where) return lead + "正在根据坐标查找地名。";
    return lead + "这张照片拍摄于" + where + "。";
  }

  function subtitle(photo) {
    let where = "还没有位置";
    if (photo.latitude != null) {
      if (photo.place) where = shortPlace(photo.place);
      else if (photo.placeStatus === "loading") where = "正在查找地名";
      else where = "已标在地图上";
    }
    const note = photo.memory && photo.memory.trim()
      ? photo.memory.trim().replace(/\s+/g, " ")
      : "还没有写下记忆";
    return where + " · " + note;
  }

  function sortPhotos() {
    photos.sort(function (a, b) {
      const as = a.sort || "";
      const bs = b.sort || "";
      if (as !== bs) return as < bs ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  async function makeThumbBlob(file) {
    try {
      const embedded = await exifr.thumbnail(file);
      if (embedded && embedded.byteLength) return new Blob([embedded], { type: "image/jpeg" });
    } catch (error) {
      // Fall through to a scaled preview of the original image.
    }
    return scaleImage(file);
  }

  function scaleImage(file) {
    return new Promise(function (resolve) {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = function () {
        const edge = 192;
        const scale = Math.min(1, edge / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          resolve(blob || null);
        }, "image/jpeg", 0.76);
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      image.src = url;
    });
  }

  function addMarker(photo) {
    const icon = L.divIcon({
      className: "photo-marker",
      html: markerHtml(photo.thumbUrl),
      iconSize: [58, 58],
      iconAnchor: [29, 29],
    });
    const marker = L.marker([photo.latitude, photo.longitude], { icon: icon, title: displayTitle(photo), keyboard: true });
    marker.on("click", function () {
      if (placingId && placingId !== photo.id) cancelPlacing();
      else if (placingId === photo.id) cancelPlacing();
      selectPhoto(photo.id, { source: "map" });
    });
    marker.on("add", updateMarkerSelection);
    photo.marker = marker;
    cluster.addLayer(marker);
    updateTooltip(photo);
  }

  function moveMarker(photo) {
    if (photo.marker) {
      cluster.removeLayer(photo.marker);
      photo.marker = null;
    }
    if (photo.latitude == null) return;
    addMarker(photo);
  }

  function markerHtml(url) {
    const image = document.createElement("img");
    image.alt = "";
    image.draggable = false;
    image.src = url;
    return image.outerHTML;
  }

  function updateTooltip(photo) {
    if (!photo.marker) return;
    const label = [displayTitle(photo), photo.place ? shortPlace(photo.place) : ""].filter(Boolean).join(" · ");
    photo.marker.unbindTooltip();
    photo.marker.bindTooltip(label, { direction: "top", offset: [0, -32] });
    photo.marker.options.title = displayTitle(photo);
  }

  function scheduleGeo(photo) {
    const run = function () {
      geoActive += 1;
      reverseGeocode(photo.latitude, photo.longitude).then(function (place) {
        photo.place = place;
        photo.placeStatus = place ? "ready" : "failed";
      }).catch(function () {
        photo.placeStatus = "failed";
      }).then(function () {
        if (photos.indexOf(photo) !== -1) {
          updateTooltip(photo);
          renderList();
          if (photo.id === selectedId) renderDetail();
          persist(photo);
        }
        geoActive -= 1;
        const next = geoQueue.shift();
        if (next) next();
      });
    };
    if (geoActive < 2) run();
    else geoQueue.push(run);
  }

  async function reverseGeocode(lat, lon) {
    const key = lat.toFixed(4) + "," + lon.toFixed(4);
    if (placeCache.has(key)) return placeCache.get(key);
    const url = "https://api.bigdatacloud.net/data/reverse-geocode-client?latitude="
      + encodeURIComponent(lat) + "&longitude=" + encodeURIComponent(lon) + "&localityLanguage=zh-Hans";
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    const place = formatPlace(data);
    placeCache.set(key, place);
    return place;
  }

  function formatPlace(data) {
    const parts = [data.principalSubdivision, data.city, data.locality];
    const unique = [];
    parts.forEach(function (part) {
      const text = typeof part === "string" ? part.trim() : "";
      if (!text || unique.indexOf(text) !== -1) return;
      const contained = unique.some(function (item) {
        return item.indexOf(text) !== -1 || text.indexOf(item) !== -1;
      });
      if (contained) {
        const last = unique[unique.length - 1];
        if (text.length > last.length && (text.indexOf(last) !== -1 || last.indexOf(text) !== -1)) unique[unique.length - 1] = text;
        return;
      }
      unique.push(text);
    });
    return unique.join(" · ");
  }

  function selectPhoto(id, options) {
    const photo = findPhoto(id);
    if (!photo) return;
    const source = options && options.source;
    if (placingId && placingId !== id) cancelPlacing();
    selectedId = id;
    renderList();
    renderDetail();
    updateMarkerSelection();
    if (source === "map") {
      const row = listEl.querySelector('[data-id="' + id + '"]');
      if (row) row.scrollIntoView({ block: "nearest" });
      if (window.innerWidth <= 900) photoButton.scrollIntoView({ block: "start" });
    }
    if ((source === "list" || source === "upload") && photo.latitude != null) focusPhoto(photo);
    if (source === "map" || source === "list" || source === "upload") {
      memoryText.focus({ preventScroll: window.innerWidth > 900 });
    }
  }

  function focusPhoto(photo) {
    if (photo.latitude == null) return;
    const center = L.latLng(photo.latitude, photo.longitude);
    const targetZoom = Math.max(map.getZoom(), 8);
    map.off("moveend", updateMarkerSelection);
    if (map.getZoom() >= targetZoom && map.getBounds().contains(center)) {
      updateMarkerSelection();
      return;
    }
    map.once("moveend", updateMarkerSelection);
    map.flyTo(center, targetZoom, { duration: 0.6 });
  }

  function updateMarkerSelection() {
    photos.forEach(function (photo) {
      const element = photo.marker && photo.marker.getElement();
      if (!element) return;
      element.classList.toggle("is-selected", photo.id === selectedId);
    });
  }

  function fitToPhotos() {
    const points = photos.filter(function (photo) { return photo.latitude != null; });
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map(function (photo) {
      return [photo.latitude, photo.longitude];
    }));
    map.fitBounds(bounds.pad(0.22), { padding: [48, 48], maxZoom: 12 });
  }

  function startPlacing(photo) {
    placingId = photo.id;
    selectedId = photo.id;
    document.body.classList.add("is-placing");
    placeBanner.hidden = false;
    placeBannerText.textContent = "在地图上点一下，安放「" + displayTitle(photo) + "」。按 Esc 取消";
    if (window.innerWidth <= 900) document.querySelector(".map-panel").scrollIntoView({ block: "start" });
    renderDetail();
    showToast("在地图空白处点一下");
  }

  function cancelPlacing() {
    placingId = null;
    document.body.classList.remove("is-placing");
    placeBanner.hidden = true;
  }

  function restoreExif() {
    const photo = currentPhoto();
    if (!photo || photo.exifLat == null) return;
    photo.latitude = photo.exifLat;
    photo.longitude = photo.exifLng;
    photo.place = "";
    photo.placeStatus = "loading";
    photo.updatedAt = Date.now();
    moveMarker(photo);
    cancelPlacing();
    scheduleGeo(photo);
    persist(photo);
    render();
    focusPhoto(photo);
  }

  function canRestore(photo) {
    if (photo.exifLat == null || photo.exifLng == null) return false;
    if (photo.latitude == null || photo.longitude == null) return true;
    return Math.abs(photo.latitude - photo.exifLat) > 1e-5 || Math.abs(photo.longitude - photo.exifLng) > 1e-5;
  }

  function placeButtonLabel(photo) {
    if (placingId === photo.id) return "正在地图上选点…";
    if (photo.latitude == null) return "在地图上选择位置";
    return "换一个位置";
  }

  function onTextEdited(photo) {
    photo.updatedAt = Date.now();
    syncRow(photo);
    updateTooltip(photo);
    writeHintEl.hidden = !!(photo.memory && photo.memory.trim());
    scheduleSave(photo);
  }

  function syncRow(photo) {
    const button = listEl.querySelector('[data-id="' + photo.id + '"]');
    if (!button) return;
    const title = button.querySelector(".row-title");
    const sub = button.querySelector(".row-sub");
    if (title) title.textContent = displayTitle(photo);
    if (sub) sub.textContent = subtitle(photo);
  }

  function autosize(element) {
    element.style.height = "auto";
    element.style.height = Math.max(96, element.scrollHeight) + "px";
  }

  function onClearClick() {
    if (!photos.length) return;
    if (!clearArmed) {
      clearArmed = true;
      clearBtn.textContent = "确认清空";
      window.clearTimeout(clearTimer);
      clearTimer = window.setTimeout(resetClear, 4000);
      showToast("再点一次，会删掉保存在这个浏览器里的照片和文字。");
      return;
    }
    performClear();
  }

  function resetClear() {
    clearArmed = false;
    clearBtn.textContent = "清空";
    window.clearTimeout(clearTimer);
  }

  function performClear() {
    storeEpoch += 1;
    Array.from(saveTimers.keys()).forEach(function (id) {
      window.clearTimeout(saveTimers.get(id));
      saveTimers.delete(id);
    });
    const removed = photos.splice(0, photos.length);
    selectedId = null;
    detailBoundId = null;
    cancelPlacing();
    resetClear();
    stickToPhotos = true;
    map.off("moveend", updateMarkerSelection);
    try {
      map.stop();
      cluster.clearLayers();
      map.setView([35.2, 104.5], 4);
    } catch (error) {
      console.error(error);
    }
    render();
    removed.forEach(revokePhoto);
    saveChain = saveChain.then(function () {
      return clearStored();
    }).catch(function (error) {
      console.error(error);
      showToast("界面已清空，但浏览器里可能还留着旧照片。");
    });
  }

  function removePhoto(photo) {
    if (placingId === photo.id) cancelPlacing();
    if (photo.marker) {
      cluster.removeLayer(photo.marker);
      photo.marker = null;
    }
    const index = photos.findIndex(function (item) { return item.id === photo.id; });
    if (index !== -1) photos.splice(index, 1);
    if (selectedId === photo.id) {
      const next = photos[index] || photos[index - 1] || null;
      selectedId = next ? next.id : null;
      detailBoundId = null;
    }
    revokePhoto(photo);
    render();
    deleteStored(photo.id).catch(function (error) {
      console.error(error);
      showToast("照片已从地图拿下，但浏览器里可能还留着一份。");
    });
  }

  function render() {
    renderList();
    renderDetail();
    updateChrome();
  }

  function renderList() {
    const scroll = listEl.scrollTop;
    const fragment = document.createDocumentFragment();
    if (!photos.length) {
      const item = document.createElement("li");
      item.className = "list-empty";
      item.textContent = "还没有照片";
      fragment.append(item);
    }
    photos.forEach(function (photo) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "row" + (photo.id === selectedId ? " is-selected" : "");
      button.dataset.id = String(photo.id);
      button.addEventListener("click", function () {
        selectPhoto(photo.id, { source: "list" });
      });

      const image = document.createElement("img");
      image.alt = "";
      image.src = photo.thumbUrl;
      const text = document.createElement("span");
      text.className = "row-text";
      const title = document.createElement("span");
      title.className = "row-title";
      title.textContent = displayTitle(photo);
      const sub = document.createElement("span");
      sub.className = "row-sub";
      sub.textContent = subtitle(photo);
      text.append(title, sub);
      button.append(image, text);
      if (photo.latitude == null) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "无位置";
        button.append(tag);
      }
      item.append(button);
      fragment.append(item);
    });
    listEl.replaceChildren(fragment);
    listEl.scrollTop = scroll;
  }

  function renderDetail() {
    const photo = currentPhoto();
    if (!photo) {
      detailBoundId = null;
      detailEmptyEl.hidden = false;
      detailBodyEl.hidden = true;
      saveStateEl.textContent = "";
      return;
    }
    detailEmptyEl.hidden = true;
    detailBodyEl.hidden = false;
    const rebind = detailBoundId !== photo.id;
    detailBoundId = photo.id;
    detailImgEl.hidden = false;
    detailImgEl.alt = displayTitle(photo);
    if (detailImgEl.dataset.src !== photo.imageUrl) {
      detailImgEl.dataset.src = photo.imageUrl;
      detailImgEl.onerror = function () { detailImgEl.hidden = true; };
      detailImgEl.src = photo.imageUrl;
    }
    detailSentenceEl.textContent = locationSentence(photo);
    writeHintEl.hidden = !!(photo.memory && photo.memory.trim());
    placeBtn.textContent = placeButtonLabel(photo);
    restoreBtn.hidden = !canRestore(photo);
    if (rebind) {
      titleInput.value = photo.title || "";
      memoryText.value = photo.memory || "";
      autosize(memoryText);
      deleteBtn.dataset.armed = "";
      deleteBtn.textContent = "移除这张照片";
      saveStateEl.textContent = "已保存";
    }
    renderFacts(photo);
  }

  function renderFacts(photo) {
    const rows = [];
    if (photo.latitude != null) rows.push(["坐标", formatCoord(photo.latitude, photo.longitude)]);
    if (photo.altitude) rows.push(["海拔", photo.altitude]);
    if (photo.when) rows.push(["时间", photo.when]);
    if (photo.camera) rows.push(["相机", photo.camera]);
    rows.push(["文件", photo.name]);
    detailFactsEl.replaceChildren();
    rows.forEach(function (row) {
      const term = document.createElement("dt");
      term.textContent = row[0];
      const description = document.createElement("dd");
      description.textContent = row[1];
      if (row[0] === "文件") description.className = "wrap";
      detailFactsEl.append(term, description);
    });
  }

  function updateChrome() {
    const located = photos.filter(function (photo) { return photo.latitude != null; }).length;
    const missing = photos.length - located;
    if (photos.length) {
      const parts = [located + " 张在地图上"];
      if (missing) parts.push(missing + " 张还没位置");
      statusEl.textContent = parts.join("，");
    } else if (!addBtn.disabled) {
      statusEl.textContent = "点开照片，就能写下记忆。有拍摄坐标的，会标到地图上。";
    }
    emptyEl.hidden = photos.length > 0;
    mapNoteEl.hidden = photos.length === 0 || located > 0;
    clearBtn.disabled = photos.length === 0 || addBtn.disabled;
    countEl.textContent = photos.length ? String(photos.length) : "";
  }

  function setBusy(busy) {
    addBtn.disabled = busy;
    samplesBtn.disabled = busy;
    clearBtn.disabled = busy || photos.length === 0;
  }

  function findPhoto(id) {
    return photos.find(function (photo) { return photo.id === id; });
  }

  function currentPhoto() {
    return findPhoto(selectedId);
  }

  function isImage(file) {
    return (file.type && file.type.indexOf("image/") === 0) || /\.(jpe?g|png|gif|webp|heic|heif|tiff?|bmp)$/i.test(file.name);
  }

  function eventHasFiles(event) {
    return event.dataTransfer && Array.from(event.dataTransfer.types || []).indexOf("Files") !== -1;
  }

  function revokePhoto(photo) {
    if (photo.imageUrl) URL.revokeObjectURL(photo.imageUrl);
    if (photo.thumbUrl && photo.thumbUrl !== photo.imageUrl) URL.revokeObjectURL(photo.thumbUrl);
  }

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toastEl.hidden = true;
    }, 4200);
  }

  function toRecord(photo) {
    return {
      id: photo.id,
      name: photo.name,
      sample: !!photo.sample,
      title: photo.title || "",
      memory: photo.memory || "",
      latitude: photo.latitude,
      longitude: photo.longitude,
      exifLat: photo.exifLat,
      exifLng: photo.exifLng,
      when: photo.when || "",
      sort: photo.sort || "",
      camera: photo.camera || "",
      altitude: photo.altitude || "",
      place: photo.place || "",
      placeStatus: photo.placeStatus || "",
      createdAt: photo.createdAt || Date.now(),
      updatedAt: photo.updatedAt || Date.now(),
    };
  }

  function scheduleSave(photo) {
    const generation = (saveGeneration.get(photo.id) || 0) + 1;
    saveGeneration.set(photo.id, generation);
    saveStateEl.textContent = "正在保存…";
    window.clearTimeout(saveTimers.get(photo.id));
    saveTimers.set(photo.id, window.setTimeout(function () {
      saveTimers.delete(photo.id);
      persist(photo, generation);
    }, 200));
  }

  function flushPendingSaves() {
    Array.from(saveTimers.keys()).forEach(function (id) {
      window.clearTimeout(saveTimers.get(id));
      saveTimers.delete(id);
      const photo = findPhoto(id);
      if (photo) persist(photo, saveGeneration.get(id) || 0);
    });
  }

  function persist(photo, generation) {
    const record = toRecord(photo);
    const blobs = photo.fileBlob ? { image: photo.fileBlob, thumb: photo.thumbBlob || null } : null;
    const id = photo.id;
    const stamp = generation == null ? (saveGeneration.get(id) || 0) : generation;
    const seenEpoch = storeEpoch;
    saveChain = saveChain.then(function () {
      if (seenEpoch !== storeEpoch) return;
      return saveRecord(record, blobs);
    }).then(function () {
      if (blobs && photo.fileBlob === blobs.image) {
        delete photo.fileBlob;
        delete photo.thumbBlob;
      }
      toldPersistError = false;
      if (selectedId === id && saveGeneration.get(id) === stamp && !saveTimers.has(id)) {
        saveStateEl.textContent = "已保存";
      }
    }).catch(function (error) {
      console.error(error);
      if (selectedId === id && saveGeneration.get(id) === stamp && !saveTimers.has(id)) {
        saveStateEl.textContent = "没能保存";
      }
      if (!toldPersistError) {
        toldPersistError = true;
        showToast("没能把记忆存进浏览器。刷新之后，这次写的内容可能会消失。");
      }
    });
    return saveChain;
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      const request = indexedDB.open("photo-map", 1);
      request.onupgradeneeded = function () {
        const database = request.result;
        if (!database.objectStoreNames.contains("memories")) database.createObjectStore("memories", { keyPath: "id" });
        if (!database.objectStoreNames.contains("files")) database.createObjectStore("files");
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  let databasePromise = null;
  function database() {
    if (!databasePromise) {
      databasePromise = openDatabase().catch(function (error) {
        databasePromise = null;
        throw error;
      });
    }
    return databasePromise;
  }

  function saveRecord(record, blobs) {
    return database().then(function (db) {
      return new Promise(function (resolve, reject) {
        const names = blobs ? ["memories", "files"] : ["memories"];
        const tx = db.transaction(names, "readwrite");
        tx.objectStore("memories").put(record);
        if (blobs) tx.objectStore("files").put({ image: blobs.image, thumb: blobs.thumb }, record.id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error("aborted")); };
      });
    });
  }

  function loadSaved() {
    return database().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(["memories", "files"], "readonly");
        const memoriesRequest = tx.objectStore("memories").getAll();
        const filesRequest = tx.objectStore("files").getAll();
        const keysRequest = tx.objectStore("files").getAllKeys();
        tx.oncomplete = function () {
          const filesById = new Map();
          keysRequest.result.forEach(function (key, index) {
            filesById.set(key, filesRequest.result[index]);
          });
          const loaded = [];
          memoriesRequest.result.forEach(function (record) {
            const stored = filesById.get(record.id);
            if (!stored || !stored.image) return;
            const imageUrl = URL.createObjectURL(stored.image);
            const thumbUrl = stored.thumb ? URL.createObjectURL(stored.thumb) : imageUrl;
            loaded.push(Object.assign({}, record, {
              imageUrl: imageUrl,
              thumbUrl: thumbUrl,
              marker: null,
            }));
          });
          resolve(loaded);
        };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function deleteStored(id) {
    return database().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(["memories", "files"], "readwrite");
        tx.objectStore("memories").delete(id);
        tx.objectStore("files").delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function clearStored() {
    return database().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(["memories", "files"], "readwrite");
        tx.objectStore("memories").clear();
        tx.objectStore("files").clear();
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  let addQueue = boot();
})();
