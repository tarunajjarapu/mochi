const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class Store {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = path.join(directory, 'state.json');
    this.state = {
      version: 1,
      settings: { endpoint: 'http://127.0.0.1:11434', model: 'qwen3:8b' },
      memories: [], reminders: [], messages: [], activity: [],
    };
    if (fs.existsSync(this.file)) {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved.version !== 1 || !['memories', 'reminders', 'messages', 'activity'].every(k => Array.isArray(saved[k]))) {
        throw new Error('Unrecognized state file. Back up state.json before repairing it.');
      }
      this.state = { ...this.state, ...saved };
    }
  }
  save() {
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
  add(collection, data, limit = 200) {
    const item = { id: randomUUID(), createdAt: new Date().toISOString(), ...data };
    const previous = this.state[collection];
    this.state[collection] = [...previous, item].slice(-limit);
    try { this.save(); } catch (error) { this.state[collection] = previous; throw error; }
    return item;
  }
  due(now = Date.now()) {
    const due = this.state.reminders.filter(r => !r.deliveredAt && Date.parse(r.at) <= now);
    if (!due.length) return [];
    for (const reminder of due) reminder.deliveredAt = new Date(now).toISOString();
    try { this.save(); } catch (error) {
      for (const reminder of due) delete reminder.deliveredAt;
      throw error;
    }
    return due;
  }
}
module.exports = { Store };
