"""Create illustrated sample photos with GPS and caption metadata."""

import io
from pathlib import Path

import piexif
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "samples"
FONT_PATH = "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"
WIDTH = 1200
HEIGHT = 800

SAMPLES = [
    {
        "filename": "bund.jpg",
        "title": "外滩",
        "caption": "外滩夜景，江风很凉。",
        "lat": 31.2397,
        "lon": 121.4900,
        "alt": 8,
        "when": "2024:10:01 18:42:00",
        "scene": "bund",
    },
    {
        "filename": "west-lake.jpg",
        "title": "西湖",
        "caption": "雨后的湖面很静，苏堤只剩一条浅影。",
        "lat": 30.2487,
        "lon": 120.1432,
        "alt": 10,
        "when": "2024:06:18 09:16:00",
        "scene": "lake",
    },
    {
        "filename": "forbidden-city.jpg",
        "title": "故宫",
        "caption": "午门前的城墙是一整块暗红色。",
        "lat": 39.9163,
        "lon": 116.3972,
        "alt": 48,
        "when": "2023:12:02 14:05:00",
        "scene": "palace",
    },
    {
        "filename": "terracotta.jpg",
        "title": "兵马俑",
        "caption": "坑里的陶俑站得密，光从棚顶落下来。",
        "lat": 34.3841,
        "lon": 109.2785,
        "alt": 440,
        "when": "2024:04:11 11:27:00",
        "scene": "warriors",
    },
    {
        "filename": "desk.jpg",
        "title": "书桌",
        "caption": "这张是在室内随手拍的，相机没有记下位置。",
        "lat": None,
        "lon": None,
        "alt": None,
        "when": "2025:01:09 21:08:00",
        "scene": "desk",
    },
]


def gradient(size, top, bottom):
    width, height = size
    column = Image.new("RGB", (1, height))
    pixels = column.load()
    for y in range(height):
        blend = y / max(height - 1, 1)
        pixels[0, y] = tuple(int(top[channel] + (bottom[channel] - top[channel]) * blend) for channel in range(3))
    return column.resize((width, height), Image.Resampling.BILINEAR)


def dms(value):
    absolute = abs(value)
    degrees = int(absolute)
    minutes_float = (absolute - degrees) * 60
    minutes = int(minutes_float)
    seconds = (minutes_float - minutes) * 60
    second_num = int(round(seconds * 10000))
    if second_num >= 600000:
        second_num -= 600000
        minutes += 1
    if minutes >= 60:
        minutes -= 60
        degrees += 1
    return ((degrees, 1), (minutes, 1), (second_num, 10000))


def gps_ifd(lat, lon, alt):
    gps = {
        piexif.GPSIFD.GPSVersionID: (2, 2, 0, 0),
        piexif.GPSIFD.GPSLatitudeRef: b"N" if lat >= 0 else b"S",
        piexif.GPSIFD.GPSLatitude: dms(lat),
        piexif.GPSIFD.GPSLongitudeRef: b"E" if lon >= 0 else b"W",
        piexif.GPSIFD.GPSLongitude: dms(lon),
    }
    if alt is not None:
        gps[piexif.GPSIFD.GPSAltitudeRef] = 0 if alt >= 0 else 1
        gps[piexif.GPSIFD.GPSAltitude] = (int(round(abs(alt) * 100)), 100)
    return gps


def xml_escape(value):
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def insert_xmp(jpeg, title, description):
    packet = f"""<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">{xml_escape(title)}</rdf:li></rdf:Alt></dc:title>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">{xml_escape(description)}</rdf:li></rdf:Alt></dc:description>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>""".encode("utf-8")
    header = b"http://ns.adobe.com/xap/1.0/\x00"
    payload = header + packet
    segment = b"\xff\xe1" + (len(payload) + 2).to_bytes(2, "big") + payload
    if not jpeg.startswith(b"\xff\xd8"):
        raise ValueError("expected a JPEG")
    return jpeg[:2] + segment + jpeg[2:]


def save_jpeg(image, path, spec):
    zeroth = {
        piexif.ImageIFD.Make: b"PhotoMap",
        piexif.ImageIFD.Model: b"Sample",
        piexif.ImageIFD.Software: b"photo-map",
        piexif.ImageIFD.ImageDescription: spec["caption"].encode("utf-8"),
        piexif.ImageIFD.XPTitle: spec["title"].encode("utf-16le"),
        piexif.ImageIFD.XPComment: spec["caption"].encode("utf-16le"),
        piexif.ImageIFD.DateTime: spec["when"].encode("ascii"),
    }
    exif = {
        piexif.ExifIFD.DateTimeOriginal: spec["when"].encode("ascii"),
        piexif.ExifIFD.DateTimeDigitized: spec["when"].encode("ascii"),
    }
    gps = {}
    if spec["lat"] is not None:
        gps = gps_ifd(spec["lat"], spec["lon"], spec["alt"])
    payload = piexif.dump({"0th": zeroth, "Exif": exif, "GPS": gps})
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=86, optimize=True, exif=payload)
    path.write_bytes(insert_xmp(buffer.getvalue(), spec["title"], spec["caption"]))


def draw_label(image, title, caption, title_font, body_font):
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rounded_rectangle((36, 36, 900, 214), radius=18, fill=(255, 250, 244, 228))
    draw.text((60, 52), title, font=title_font, fill=(34, 24, 20, 255))
    draw.text((60, 128), caption, font=body_font, fill=(72, 52, 44, 255))
    composed = Image.alpha_composite(image.convert("RGBA"), overlay)
    return composed.convert("RGB")


def paint(scene):
    if scene == "bund":
        image = gradient((WIDTH, HEIGHT), (48, 28, 58), (232, 126, 78))
        draw = ImageDraw.Draw(image)
        horizon = 500
        draw.rectangle((0, horizon, WIDTH, HEIGHT), fill=(24, 48, 74))
        x = 30
        step = 0
        while x < WIDTH - 20:
            step += 1
            block_width = 46 + (step * 37) % 48
            block_height = 90 + (step * 53) % 180
            draw.rectangle((x, horizon - block_height, x + block_width, horizon), fill=(34, 24, 32))
            for window_y in range(horizon - block_height + 14, horizon - 12, 18):
                for window_x in range(x + 8, x + block_width - 10, 14):
                    if (window_x * 3 + window_y) % 5 != 0:
                        draw.rectangle((window_x, window_y, window_x + 5, window_y + 8), fill=(255, 214, 150))
            x += block_width + 10
        draw.rectangle((0, 560, WIDTH, 572), fill=(214, 164, 112))
        return image

    if scene == "lake":
        image = gradient((WIDTH, HEIGHT), (176, 214, 206), (236, 242, 232))
        draw = ImageDraw.Draw(image)
        draw.ellipse((-80, 250, 520, 620), fill=(92, 148, 112))
        draw.ellipse((620, 180, 1280, 560), fill=(78, 132, 104))
        draw.rectangle((0, 430, WIDTH, HEIGHT), fill=(78, 156, 162))
        draw.arc((180, 390, 1020, 760), 200, 340, fill=(244, 244, 236), width=14)
        draw.ellipse((860, 120, 980, 240), fill=(255, 248, 230))
        return image

    if scene == "palace":
        image = gradient((WIDTH, HEIGHT), (198, 208, 214), (232, 220, 204))
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 470, WIDTH, HEIGHT), fill=(196, 176, 148))
        draw.rectangle((80, 250, WIDTH - 80, 500), fill=(168, 52, 42))
        draw.polygon([(40, 270), (WIDTH / 2, 120), (WIDTH - 40, 270)], fill=(214, 168, 72))
        draw.rectangle((520, 330, 680, 500), fill=(92, 42, 36))
        return image

    if scene == "warriors":
        image = gradient((WIDTH, HEIGHT), (92, 64, 46), (168, 112, 72))
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 430, WIDTH, HEIGHT), fill=(112, 72, 48))
        for index in range(9):
            left = 70 + index * 124
            draw.rectangle((left, 300, left + 70, 560), fill=(92, 56, 40))
            draw.ellipse((left + 8, 246, left + 62, 320), fill=(128, 84, 58))
        draw.polygon([(0, 180), (260, 80), (520, 180), (0, 260)], fill=(232, 214, 180))
        return image

    image = gradient((WIDTH, HEIGHT), (86, 72, 64), (48, 40, 36))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 470, WIDTH, HEIGHT), fill=(74, 52, 40))
    draw.ellipse((860, 40, 1160, 340), fill=(232, 186, 120))
    draw.rectangle((140, 390, 460, 470), fill=(236, 228, 214))
    draw.rectangle((180, 360, 420, 430), fill=(92, 112, 104))
    draw.polygon([(150, 500), (430, 500), (470, 760), (110, 760)], fill=(52, 38, 32))
    return image


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    title_font = ImageFont.truetype(FONT_PATH, 54)
    body_font = ImageFont.truetype(FONT_PATH, 28)
    for spec in SAMPLES:
        image = draw_label(paint(spec["scene"]), spec["title"], spec["caption"], title_font, body_font)
        save_jpeg(image, OUT / spec["filename"], spec)
        print(spec["filename"])


if __name__ == "__main__":
    main()
