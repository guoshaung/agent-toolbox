const test=require('node:test'),assert=require('node:assert/strict');
const {taskbarConfig}=require('../src/main/beauty-taskbar');
test('taskbar states use one selected appearance and do not enable startup or touch fonts',()=>{const c=taskbarConfig({effect:'acrylic',tint:'#123456',opacity:72,blur:22});assert.equal(c.desktop_appearance.accent,'acrylic');assert.equal(c.desktop_appearance.color,'#123456b8');assert.equal(c.start_opened_appearance.enabled,true);assert.equal(c.disable_saving,true);assert.ok(!/font|startup|registry/i.test(JSON.stringify(c)));});
