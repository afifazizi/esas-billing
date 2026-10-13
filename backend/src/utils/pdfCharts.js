// Vector charts styled to match the Professional Template v9 report.

const GRID = '#D8DDE2';
const TEXT = '#333333';
const MUTED = '#6F767D';
const ORANGE = '#F58220';

const CLUSTER_COLORS = Object.freeze({
  ARCHIVE: '#E89496',
  'DA (OLD ARCHIVE)': '#F6C58F',
  NEWS: '#F8DE91',
  NEARLINE: '#ADD09F',
  'POST PRODUCTION': '#BBD3E7',
});

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value || '').toUpperCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function clusterColor(name) {
  const normalized = String(name || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (normalized.includes('DA (OLD ARCHIVE)') || normalized.includes('DA OLD ARCHIVE') || normalized.includes('DALET')) return CLUSTER_COLORS['DA (OLD ARCHIVE)'];
  if (normalized.includes('POST PRODUCTION') || normalized.includes('POST PROD')) return CLUSTER_COLORS['POST PRODUCTION'];
  if (normalized.includes('NEARLINE')) return CLUSTER_COLORS.NEARLINE;
  if (normalized.includes('NEWS') || normalized.includes('NRCS')) return CLUSTER_COLORS.NEWS;
  if (normalized.includes('ARCHIVE')) return CLUSTER_COLORS.ARCHIVE;
  const fallback = ['#C7B6E6', '#A9D8D3', '#D8B7A6', '#BFC8D6', '#D4C89B'];
  return fallback[stableHash(normalized) % fallback.length];
}

export function formatAxisMax(maxValue) {
  return `${Number(maxValue).toLocaleString()} GB`;
}

function truncateLabel(value, maxLength = 30) {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function niceMax(value, steps = 4) {
  const raw = Math.max(Number(value) || 0, 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return Math.ceil((nice * magnitude) / steps) * steps;
}

function rowColor(row, labelKey) {
  return clusterColor(row.cluster || row.deptName || row.clusterName || row[labelKey]);
}

export function drawHorizontalBarChart(doc, {
  y,
  rows,
  labelKey,
  valueKey,
  maxRows = 12,
  x = 57,
  width = 482,
  height = 205,
}) {
  const limited = rows.slice(0, maxRows);
  const labelWidth = 118;
  const plotX = x + labelWidth + 4;
  const plotWidth = width - labelWidth - 20;
  const top = y + 8;
  const bottom = y + height - 18;
  const plotHeight = bottom - top;
  const maxValue = niceMax(Math.max(...limited.map((row) => Number(row[valueKey] || 0)), 1), 5);

  doc.strokeColor(GRID).lineWidth(0.45);
  for (let i = 0; i <= 5; i += 1) {
    const gx = plotX + (plotWidth * i) / 5;
    doc.moveTo(gx, top).lineTo(gx, bottom).stroke();
    doc.fillColor(MUTED).font('Helvetica').fontSize(5.7)
      .text(Math.round((maxValue * i) / 5).toLocaleString(), gx - 22, bottom + 5, { width: 44, align: 'center' });
  }

  if (!limited.length) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('No data available', x, y + height / 2, { width, align: 'center' });
    return y + height;
  }

  const slot = plotHeight / limited.length;
  const barH = Math.max(5, Math.min(11, slot * 0.66));
  limited.forEach((row, index) => {
    const value = Number(row[valueKey] || 0);
    const cy = top + index * slot + slot / 2;
    const barW = Math.max(0.8, (value / maxValue) * plotWidth);
    doc.fillColor(TEXT).font('Helvetica').fontSize(5.8)
      .text(truncateLabel(row[labelKey], 31), x, cy - 3, { width: labelWidth - 4, align: 'right', lineBreak: false });
    doc.rect(plotX, cy - barH / 2, barW, barH).fill(rowColor(row, labelKey));
  });
  return y + height;
}

export function drawVerticalBarChart(doc, {
  y,
  rows,
  labelKey,
  valueKey,
  maxRows = 10,
  x = 57,
  width = 482,
  height = 210,
}) {
  const limited = rows.slice(0, maxRows);
  const left = x + 51;
  const right = x + width - 20;
  const top = y + 10;
  const bottom = y + height - 39;
  const plotWidth = right - left;
  const plotHeight = bottom - top;
  const maxValue = niceMax(Math.max(...limited.map((row) => Number(row[valueKey] || 0) / 1024), 1), 4);

  doc.strokeColor(GRID).lineWidth(0.45);
  for (let i = 0; i <= 4; i += 1) {
    const gy = bottom - (plotHeight * i) / 4;
    doc.moveTo(left, gy).lineTo(right, gy).stroke();
    doc.fillColor(MUTED).font('Helvetica').fontSize(6)
      .text(Math.round((maxValue * i) / 4).toLocaleString(), x + 17, gy - 3, { width: 31, align: 'right' });
  }

  if (!limited.length) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('No data available', x, y + height / 2, { width, align: 'center' });
    return y + height;
  }

  const slot = plotWidth / limited.length;
  const barW = Math.min(55, slot * 0.67);
  limited.forEach((row, index) => {
    const valueTb = Number(row[valueKey] || 0) / 1024;
    const barH = Math.max(0.8, (valueTb / maxValue) * plotHeight);
    const bx = left + index * slot + (slot - barW) / 2;
    doc.rect(bx, bottom - barH, barW, barH).fill(rowColor(row, labelKey));
    doc.fillColor(TEXT).font('Helvetica').fontSize(5.7)
      .text(truncateLabel(row[labelKey], 13), left + index * slot, bottom + 8, { width: slot, align: 'center' });
  });
  return y + height;
}

function drawLineAxes(doc, { x, y, width, height, months, maxValue, tickCount = 8 }) {
  const left = x + 48;
  const right = x + width - 22;
  const top = y + 8;
  const bottom = y + height - 28;
  const plotWidth = right - left;
  const plotHeight = bottom - top;
  doc.strokeColor(GRID).lineWidth(0.4);
  for (let i = 0; i <= tickCount; i += 1) {
    const gy = bottom - (plotHeight * i) / tickCount;
    doc.moveTo(left, gy).lineTo(right, gy).stroke();
    doc.fillColor(MUTED).font('Helvetica').fontSize(5.7)
      .text(Math.round((maxValue * i) / tickCount).toLocaleString(), x + 2, gy - 3, { width: 42, align: 'right' });
  }
  const stepX = months.length > 1 ? plotWidth / (months.length - 1) : plotWidth;
  months.forEach((month, i) => {
    const px = months.length > 1 ? left + i * stepX : left + plotWidth / 2;
    doc.fillColor(TEXT).font('Helvetica').fontSize(6).text(month, px - 18, bottom + 8, { width: 36, align: 'center' });
  });
  return { left, right, top, bottom, plotWidth, plotHeight, stepX };
}

export function drawLineChart(doc, { y, rows, labelKey, valueKey, x = 57, width = 482, height = 205, color = ORANGE }) {
  const months = rows.map((row) => row[labelKey]);
  const values = rows.map((row) => Number(row[valueKey] || 0));
  const maxValue = niceMax(Math.max(...values, 1), 8);
  const axes = drawLineAxes(doc, { x, y, width, height, months, maxValue });
  if (!rows.length) return y + height;
  doc.strokeColor(color).lineWidth(1.25);
  values.forEach((value, i) => {
    const px = months.length > 1 ? axes.left + i * axes.stepX : axes.left + axes.plotWidth / 2;
    const py = axes.bottom - (value / maxValue) * axes.plotHeight;
    if (i === 0) doc.moveTo(px, py); else doc.lineTo(px, py);
  });
  doc.stroke();
  return y + height;
}

export function drawMultiLineChart(doc, { y, months, series, x = 57, width = 482, height = 205 }) {
  const valOf = (entry, month) => Number(entry.values?.[month] || 0);
  let maxValue = 1;
  for (const entry of series) for (const month of months) maxValue = Math.max(maxValue, valOf(entry, month));
  maxValue = niceMax(maxValue, 8);
  const axes = drawLineAxes(doc, { x, y, width, height, months, maxValue });
  series.forEach((entry) => {
    const color = clusterColor(entry.name);
    doc.strokeColor(color).lineWidth(1.05);
    months.forEach((month, i) => {
      const px = months.length > 1 ? axes.left + i * axes.stepX : axes.left + axes.plotWidth / 2;
      const py = axes.bottom - (valOf(entry, month) / maxValue) * axes.plotHeight;
      if (i === 0) doc.moveTo(px, py); else doc.lineTo(px, py);
    });
    doc.stroke();
  });
  return y + height;
}

// Backward-compatible name retained for callers while rendering a line chart.
export const drawGroupedTrendChart = drawMultiLineChart;
