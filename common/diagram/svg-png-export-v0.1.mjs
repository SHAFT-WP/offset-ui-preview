export const SVG_PNG_EXPORT_V0_1 = Object.freeze({
  id: "svg-png-export-v0.1",
  version: "0.1.1",
});

function styledClone(svg) {
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
  return clone;
}

export function prepareSvgForExport(svg, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  const clone = styledClone(svg);
  const viewBox = svg.viewBox.baseVal;
  const legend = options.legend ?? (svg.dataset.exportLegend ? document.getElementById(svg.dataset.exportLegend) : null);
  if (!legend) return { svg: clone, width: viewBox.width, height: viewBox.height };
  const footer = styledClone(legend);
  const legendBox = legend.viewBox.baseVal;
  if (!(legendBox.width > 0 && legendBox.height > 0)) throw new Error("Legend has no rendered viewBox");
  const footerHeight = viewBox.width * legendBox.height / legendBox.width;
  const height = viewBox.height + footerHeight;
  const composite = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  composite.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  composite.setAttribute("viewBox", `0 0 ${viewBox.width} ${height}`);
  // Nested viewports preserve the current plot pan/zoom and all moved labels.
  clone.setAttribute("x", "0"); clone.setAttribute("y", "0");
  clone.setAttribute("width", viewBox.width); clone.setAttribute("height", viewBox.height);
  clone.style.overflow = "hidden";
  footer.setAttribute("x", "0"); footer.setAttribute("y", viewBox.height);
  footer.setAttribute("width", viewBox.width); footer.setAttribute("height", footerHeight);
  composite.append(clone, footer);
  return { svg: composite, width: viewBox.width, height };
}

export function saveSvgAsPng(svg, filename, options = {}) {
  const scale = options.scale ?? 2;
  const prepared = prepareSvgForExport(svg, options);
  prepared.svg.setAttribute("width", prepared.width * scale);
  prepared.svg.setAttribute("height", prepared.height * scale);
  const markup = new XMLSerializer().serializeToString(prepared.svg);
  const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const image = new Image();

  return new Promise((resolve, reject) => {
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = prepared.width * scale;
      canvas.height = prepared.height * scale;
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
