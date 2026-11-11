#!/usr/bin/env python3
"""本地 OCR 适配器：使用 RapidOCR 识别截图，输出 JSON 给 Node 服务读取。

用法：python ocr.py <image_path> <output_json_path>
"""
import json
import sys
import time


def fail(message):
    return {"ok": False, "engine": "rapidocr", "error": str(message)}


def main():
    if len(sys.argv) < 3:
        print("usage: python ocr.py <image_path> <output_json>", file=sys.stderr)
        return 2
    image_path, output_path = sys.argv[1], sys.argv[2]
    started = time.time()
    data = {}
    try:
        from PIL import Image
        from rapidocr_onnxruntime import RapidOCR

        engine = RapidOCR()
        result, elapse = engine(image_path)
        items = []
        for box, text, score in result or []:
            xs = [float(point[0]) for point in box]
            ys = [float(point[1]) for point in box]
            items.append({
                "text": str(text),
                "score": round(float(score), 4),
                "x": round(min(xs)),
                "y": round(min(ys)),
                "w": round(max(xs) - min(xs)),
                "h": round(max(ys) - min(ys)),
            })
        items.sort(key=lambda item: (item["y"], item["x"]))
        with Image.open(image_path) as image:
            width, height = image.size
        data = {
            "ok": True,
            "engine": "rapidocr",
            "width": width,
            "height": height,
            "items": items,
            "elapsed": round(time.time() - started, 2),
            "engineElapsed": [round(float(item), 3) for item in (elapse or [])],
        }
    except Exception as error:  # noqa: BLE001
        data = fail(error)
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False)
    return 0 if data.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
