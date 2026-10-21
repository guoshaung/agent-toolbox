'use strict';

// Windows documents these values under HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize.
// https://learn.microsoft.com/en-us/windows/apps/develop/settings/settings-common
const PERSONALIZATION_FIELDS = ['AppsUseLightTheme', 'SystemUsesLightTheme', 'EnableTransparency'];

function normalizeWindowsOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Windows 外观选项无效');
  const choice = (name, choices) => {
    const value = input[name] ?? 'keep';
    if (!choices.includes(value)) throw new Error('Windows 外观选项无效');
    return value;
  };
  return { apps: choice('apps', ['keep', 'light', 'dark']), system: choice('system', ['keep', 'light', 'dark']),
    transparency: choice('transparency', ['keep', 'on', 'off']) };
}

function personalizationPlan(input) {
  const options = normalizeWindowsOptions(input), values = {};
  for (const [key, option, on] of [['AppsUseLightTheme', options.apps, 'light'], ['SystemUsesLightTheme', options.system, 'light'], ['EnableTransparency', options.transparency, 'on']]) {
    if (option !== 'keep') values[key] = { exists: true, kind: 'DWord', value: option === on ? 1 : 0 };
  }
  return values;
}

function validatePersonalizationValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.keys(values).length) throw new Error('Windows 外观备份无效');
  const clean = {};
  for (const [key, entry] of Object.entries(values)) {
    if (!PERSONALIZATION_FIELDS.includes(key) || !entry || typeof entry.exists !== 'boolean') throw new Error('Windows 外观备份包含无效字段');
    if (!entry.exists) { clean[key] = { exists: false }; continue; }
    if (entry.kind !== 'DWord' || !Number.isInteger(entry.value) || entry.value < 0 || entry.value > 0xffffffff) throw new Error('Windows 外观值类型无法安全恢复，已停止操作');
    clean[key] = { exists: true, kind: 'DWord', value: entry.value };
  }
  return clean;
}

module.exports = { PERSONALIZATION_FIELDS, normalizeWindowsOptions, personalizationPlan, validatePersonalizationValues };
