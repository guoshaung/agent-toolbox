const calendar = events => 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Agent Toolbox//T096//ZH\n' + events + 'END:VCALENDAR\n';
const weekly = 'BEGIN:VEVENT\nUID:weekly-demo@example.test\nDTSTAMP:20261001T000000Z\nDTSTART:20261005T010000Z\nDTEND:20261005T020000Z\nSUMMARY:每周例会\nRRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4\nEXDATE:20261012T010000Z\nX-ORIGIN:保留未知字段\nEND:VEVENT\n';
const single = 'BEGIN:VEVENT\nUID:single-demo@example.test\nDTSTAMP:20261001T000000Z\nDTSTART:20261005T010000Z\nDTEND:20261005T020000Z\nSUMMARY:单次迁移检查\nDESCRIPTION:第一行\\n第二行\\,带标点\\;保留\nEND:VEVENT\n';
export const EXAMPLES = Object.freeze({ weekly: calendar(weekly), duplicates: calendar(weekly + weekly + weekly.replace('SUMMARY:每周例会', 'SUMMARY:同 UID 不同内容')), single: calendar(single) });
