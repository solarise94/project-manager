export interface SmartFillResult {
  name?: string;
  description?: string;
  orderNumber?: string;
  organization?: string;
  client?: string;
  representative?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

function splitLine(line: string): string[] {
  // Try tab first, then multiple spaces
  if (line.includes("\t")) {
    return line.split("\t").map((s) => s.trim());
  }
  // Split by 2+ spaces
  return line.split(/\s{2,}/).map((s) => s.trim());
}

function convertDate(dateStr: string): string | undefined {
  if (!dateStr) return undefined;
  // Support YYYY/MM/DD and YYYY-MM-DD
  const normalized = dateStr.replace(/\//g, "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return undefined;
  const [, y, m, d] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function mapStatus(statusStr: string): string | undefined {
  const map: Record<string, string> = {
    "预实验": "NOT_STARTED",
    "未开始": "NOT_STARTED",
    "进行中": "IN_PROGRESS",
    "已交付": "COMPLETED",
    "已完成": "COMPLETED",
    "暂停": "ON_HOLD",
  };
  return map[statusStr] || undefined;
}

export function parseSmartFill(text: string): SmartFillResult {
  const lines = text.trim().split(/\n/).filter((l) => l.trim());
  if (lines.length === 0) throw new Error("请输入文本内容");

  const firstLine = lines[0];
  const cols = splitLine(firstLine);

  // Need at least 8 columns to be meaningful
  if (cols.length < 8) {
    throw new Error("文本格式不正确，至少需要8列数据");
  }

  const result: SmartFillResult = {};

  // Column mapping based on the template:
  // 0: orderNumber, 1: internal code, 2: organization, 3: client, 4: representative,
  // 5: contact, 6: type, 7: name, 8: quantity, 9: spec, 10: sub-unit, 11: status,
  // 12: startDate, 13: endDate

  if (cols[0]) result.orderNumber = cols[0];
  if (cols[2]) result.organization = cols[2];
  if (cols[3]) result.client = cols[3];
  if (cols[4]) result.representative = cols[4];

  // Combine type and name for the project name
  const typeStr = cols[6] || "";
  const contentStr = cols[7] || "";
  if (contentStr) {
    result.name = contentStr;
    if (typeStr) {
      result.description = `类型：${typeStr}${cols[8] ? `，数量：${cols[8]}` : ""}${cols[9] ? `，规格：${cols[9]}` : ""}`;
    }
  }

  if (cols[11]) {
    const mapped = mapStatus(cols[11]);
    if (mapped) result.status = mapped;
  }

  // Date handling: first date = startDate, second date = endDate (if present)
  const dateCols = cols.slice(12).filter((c) => c && /^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(c.trim()));
  if (dateCols.length >= 1) {
    const s = convertDate(dateCols[0]);
    if (s) result.startDate = s;
  }
  if (dateCols.length >= 2) {
    const e = convertDate(dateCols[1]);
    if (e) result.endDate = e;
  }

  return result;
}
