import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isWithinDailyWindow,
  parseTimeToMinutes,
  renderAutomationMessage,
  shouldSendGreeting,
  shouldSendOutOfOffice
} from '../src/automation.js';

test('renderAutomationMessage replaces supported variables', () => {
  const text = renderAutomationMessage(
    'Hi {{name}} / {{first_name}} at {{company}} on {{channel}}',
    { contactName: 'Ada Lovelace', company: 'Analytical Engines', channelName: 'WhatsApp Support' }
  );
  assert.equal(text, 'Hi Ada Lovelace / Ada at Analytical Engines on WhatsApp Support');
});

test('shouldSendGreeting respects quiet-interval hours', () => {
  const now = Date.parse('2026-11-12T12:00:00.000Z');
  assert.equal(shouldSendGreeting({
    enabled: true,
    intervalHours: 24,
    previousInboundAt: '',
    now
  }), true);
  assert.equal(shouldSendGreeting({
    enabled: true,
    intervalHours: 24,
    previousInboundAt: '2026-11-12T01:00:00.000Z',
    now
  }), false);
  assert.equal(shouldSendGreeting({
    enabled: true,
    intervalHours: 6,
    previousInboundAt: '2026-11-12T01:00:00.000Z',
    now
  }), true);
  assert.equal(shouldSendGreeting({
    enabled: false,
    intervalHours: 0,
    previousInboundAt: '',
    now
  }), false);
});

test('out-of-office window supports overnight ranges', () => {
  assert.equal(parseTimeToMinutes('18:00'), 18 * 60);
  assert.equal(parseTimeToMinutes('09:30'), 9 * 60 + 30);
  assert.equal(isWithinDailyWindow(19 * 60, 18 * 60, 9 * 60), true);
  assert.equal(isWithinDailyWindow(8 * 60, 18 * 60, 9 * 60), true);
  assert.equal(isWithinDailyWindow(12 * 60, 18 * 60, 9 * 60), false);
  assert.equal(isWithinDailyWindow(10 * 60, 9 * 60, 17 * 60), true);
  assert.equal(isWithinDailyWindow(18 * 60, 9 * 60, 17 * 60), false);
});

test('shouldSendOutOfOffice uses timezone local clock', () => {
  // 2026-11-12 20:30 IST == 15:00 UTC
  const eveningIst = new Date('2026-11-12T15:00:00.000Z');
  assert.equal(shouldSendOutOfOffice({
    enabled: true,
    timezone: 'Asia/Kolkata',
    startTime: '18:00',
    endTime: '09:00',
    now: eveningIst
  }), true);

  // 2026-11-12 12:00 IST == 06:30 UTC
  const middayIst = new Date('2026-11-12T06:30:00.000Z');
  assert.equal(shouldSendOutOfOffice({
    enabled: true,
    timezone: 'Asia/Kolkata',
    startTime: '18:00',
    endTime: '09:00',
    now: middayIst
  }), false);
});
