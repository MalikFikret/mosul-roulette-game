// Tiny DOM helpers. Text is always set with textContent (never innerHTML), so player names and
// anything read from the database can never become markup.

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Creates an element. `props`: `class`, `text` (textContent), `on` ({ click: fn }), boolean
 * properties (`disabled`, `checked`) and plain attributes. Children: nodes or strings (strings
 * become text nodes).
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

function applyProps(el, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') el.textContent = String(value);
    else if (key === 'class') el.className = value;
    else if (key === 'on') for (const [event, fn] of Object.entries(value)) el.addEventListener(event, fn);
    else if (key === 'disabled' || key === 'checked' || key === 'value') el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
}

/** An SVG element tree from a static description: [tag, attrs, ...children]. Code-defined only. */
export function svg([tag, attrs = {}, ...children]) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  for (const child of children) el.append(svg(child));
  return el;
}

/** Replaces the contents of `parent`. */
export function replace(parent, ...children) {
  parent.replaceChildren(...children.flat().filter(Boolean));
}
