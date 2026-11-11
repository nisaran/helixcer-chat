/** Greeting and out-of-office automation helpers. */

export const AUTOMATION_VARIABLE_HINT = '{{name}}, {{company}}, {{channel}}';
export const AUTOMATION_TIMEZONES = Object.freeze([
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'UTC'
]);

export function defaultAutomationSettings(workspaceId = '') {
  return {
    workspaceId: String(workspaceId || ''),
    greetingEnabled: false,
    greetingMessage: '',
    greetingIntervalHours: 24,
    oooEnabled: false,
    oooMessage: '',
    oooTimezone: 'Asia/Kolkata',
    oooStartTime: '18:00',
    oooEndTime: '09:00',
    updatedAt: '',
    updatedBy: ''
  };
}

export function serializeAutomationSettings(row, workspaceId = '') {
  if (!row) return defaultAutomationSettings(workspaceId);
  return {
    workspaceId: String(row.workspace_id || workspaceId || ''),
    greetingEnabled: Number(row.greeting_enabled || 0) === 1,
    greetingMessage: String(row.greeting_message || ''),
    greetingIntervalHours: Number(row.greeting_interval_hours || 24),
    oooEnabled: Number(row.ooo_enabled || 0) === 1,
    oooMessage: String(row.ooo_message || ''),
    oooTimezone: String(row.ooo_timezone || 'Asia/Kolkata'),
    oooStartTime: String(row.ooo_start_time || '18:00'),
    oooEndTime: String(row.ooo_end_time || '09:00'),
    updatedAt: String(row.updated_at || ''),
    updatedBy: String(row.updated_by || '')
  };
}

export function parseTimeToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return (hours * 60) + minutes;
}

/** True when local clock minutes fall inside [start, end), including overnight windows. */
export function isWithinDailyWindow(localMinutes, startMinutes, endMinutes) {
  if (!Number.isFinite(localMinutes) || startMinutes == null || endMinutes == null) return false;
  if (startMinutes === endMinutes) return true; // 24-hour window
  if (startMinutes < endMinutes) return localMinutes >= startMinutes && localMinutes < endMinutes;
  return localMinutes >= startMinutes || localMinutes < endMinutes;
}

export function localMinutesInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone || 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return (hour * 60) + minute;
}

export function localDayKey(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

export function renderAutomationMessage(template, { contactName = '', company = '', channelName = '' } = {}) {
  const firstName = String(contactName || '').trim().split(/\s+/)[0] || 'there';
  const map = {
    name: String(contactName || '').trim() || firstName,
    first_name: firstName,
    firstName,
    company: String(company || '').trim(),
    channel: String(channelName || '').trim()
  };
  return String(template || '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, rawKey) => {
    const key = String(rawKey || '').trim();
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : match;
  }).trim();
}

export function shouldSendGreeting({ enabled, intervalHours, previousInboundAt, now = Date.now() }) {
  if (!enabled) return false;
  const hours = Number(intervalHours);
  if (!Number.isFinite(hours) || hours < 0) return false;
  if (!previousInboundAt) return true;
  const previous = Date.parse(previousInboundAt);
  if (!Number.isFinite(previous)) return true;
  return (now - previous) >= (hours * 60 * 60 * 1000);
}

export function shouldSendOutOfOffice({ enabled, timezone, startTime, endTime, now = new Date() }) {
  if (!enabled) return false;
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start == null || end == null) return false;
  let localMinutes;
  try {
    localMinutes = localMinutesInTimeZone(now, timezone);
  } catch {
    return false;
  }
  return isWithinDailyWindow(localMinutes, start, end);
}
