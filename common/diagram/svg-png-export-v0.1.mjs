export const SVG_PNG_EXPORT_V0_1 = Object.freeze({
  id: "svg-png-export-v0.1",
  version: "0.1.0",
});

export function saveSvgAsPng(svg, filename, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  const scale = options.scale ?? 2;
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  const sourceNodes = [svg, ...svg.querySelectorAll("*")];
  const cloneNodes = [clone, ...clone.querySelectorAll("*")];
  sourceNodes.forEach((source, index) => {
    const target = cloneNodes[index];
    const computed = window.getComputedStyle(source);
    ["fill", "stroke", "color", "font-family", "font-size", "font-weight"].forEach((property) => {
      const value = computed.getPropertyValue(property);
      if (value && value !== "none") target.style.setProperty(property, value);
    });
  });

  const viewBox = svg.viewBox.baseVal;
  clone.setAttribute("width", viewBox.width * scale);
  clone.setAttribute("height", viewBox.height * scale);
  const markup = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const image = new Image();

  return new Promise((resolve, reject) => {
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = viewBox.width * scale;
      canvas.height = viewBox.height * scale;
      const context = canvas.getContext("2d");
      const background = options.background ?? window.getComputedStyle(svg.parentElement).backgroundColor;
      context.fillStyle = background && background !== "rgba(0, 0, 0, 0)" ? background : "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((png) => {
        if (!png) {
          reject(new Error("PNG blob creation failed"));
          return;
        }
        const pngUrl = URL.createObjectURL(png);
        const link = document.createElement("a");
        link.href = pngUrl;
        link.download = filename;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
        resolve({ width: canvas.width, height: canvas.height, filename });
      }, "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("PNG rasterization failed"));
    };
    image.src = url;
  });
}
