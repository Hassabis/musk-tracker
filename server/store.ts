import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Post, Tracking, Status } from '../src/lib/types.ts'
export class Store {
  db: DatabaseSync
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, type TEXT NOT NULL, text TEXT NOT NULL, data TEXT NOT NULL, present INTEGER NOT NULL DEFAULT 1);
      CREATE INDEX IF NOT EXISTS posts_created ON posts(created_at);
      CREATE TABLE IF NOT EXISTS revisions (post_id TEXT NOT NULL, observed_at TEXT NOT NULL, raw TEXT NOT NULL, PRIMARY KEY(post_id, observed_at, raw));
      CREATE TABLE IF NOT EXISTS coverage (start INTEGER PRIMARY KEY, end INTEGER NOT NULL, checked_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS trackings (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_runs (id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, ended_at TEXT, status TEXT NOT NULL, detail TEXT);
    `)
  }
  get<T>(key: string, fallback: T): T { const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key); return row ? JSON.parse(row.value as string) : fallback }
  set(key: string, value: unknown) { this.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)) }
  ingest(posts: Post[], start: number, end: number) {
    const now = new Date().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('UPDATE posts SET present=0 WHERE created_at>=? AND created_at<=?').run(new Date(start).toISOString(), new Date(end).toISOString())
      for (const post of posts) {
        const old = this.db.prepare('SELECT data FROM posts WHERE id=?').get(post.id)
        const previous: Post | null = old ? JSON.parse(old.data as string) : null
        if (previous) post.firstSeen = previous.firstSeen
        if (!previous || JSON.stringify(previous.raw) !== JSON.stringify(post.raw)) this.db.prepare('INSERT OR IGNORE INTO revisions VALUES (?,?,?)').run(post.id, now, JSON.stringify(post.raw))
        this.db.prepare('INSERT INTO posts VALUES (?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at,type=excluded.type,text=excluded.text,data=excluded.data,present=1').run(post.id, post.createdAt, post.type, post.text, JSON.stringify(post))
      }
      this.db.prepare('INSERT INTO coverage VALUES (?,?,?) ON CONFLICT(start) DO UPDATE SET end=MAX(coverage.end,excluded.end),checked_at=excluded.checked_at').run(start, end, now)
      this.db.exec('COMMIT')
    } catch (err) { this.db.exec('ROLLBACK'); throw err }
  }
  posts(start: number, end: number, archived = false): Post[] {
    return this.db.prepare(`SELECT data FROM posts WHERE created_at>=? AND created_at<=? ${archived ? '' : 'AND present=1'} ORDER BY created_at DESC,id DESC`).all(new Date(start).toISOString(), new Date(end).toISOString()).map(r => JSON.parse(r.data as string))
  }
  covered(start: number, end: number) {
    const rows = this.db.prepare('SELECT start,end FROM coverage WHERE end>=? AND start<=? ORDER BY start').all(start,end)
    let next = start
    for (const r of rows) { if (Number(r.start) > next) return false; next = Math.max(next, Number(r.end) + 1); if (next > end) return true }
    return false
  }
  saveTracking(tracking: Tracking) { this.db.prepare('INSERT INTO trackings VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(tracking.id, JSON.stringify(tracking)) }
  count(start:number,end:number){return Number(this.db.prepare('SELECT COUNT(*) n FROM posts WHERE created_at>=? AND created_at<=? AND present=1').get(new Date(start).toISOString(),new Date(end).toISOString())!.n)}
  timestamps(start:number,end:number){return this.db.prepare('SELECT created_at FROM posts WHERE present=1 AND created_at>=? AND created_at<=? ORDER BY created_at').all(new Date(start).toISOString(),new Date(end).toISOString()).map(row=>Date.parse(String(row.created_at)))}
  coverage(){return this.db.prepare('SELECT start,end FROM coverage ORDER BY start').all().map(row=>({start:Number(row.start),end:Number(row.end)}))}
  startRun(started:string){return this.db.prepare('INSERT INTO sync_runs(started_at,status) VALUES (?,?)').run(started,'running').lastInsertRowid}
  finishRun(id:string|number|bigint,status:string,detail?:string){this.db.prepare('UPDATE sync_runs SET ended_at=?,status=?,detail=? WHERE id=?').run(new Date().toISOString(),status,detail??null,id)}
  runs(){return this.db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 40').all()}
  acquireLease(_token:string,_minimumInterval=0){return true}
  releaseLease(_token:string){}
  trackings(): Tracking[] { return this.db.prepare('SELECT data FROM trackings').all().map(r => JSON.parse(r.data as string)) }
  status(): Status {
    const currentRecords=Number(this.db.prepare('SELECT COUNT(*) AS n FROM posts WHERE present=1').get()!.n)
    const sourceTotal=this.get<number|null>('sourceTotal',null)
    return { state: this.get('state', 'idle'), lastSuccess: this.get('lastSuccess', null), lastAttempt: this.get('lastAttempt', null), error: this.get('error', null), sourceTotal, currentRecords, archiveDifference: sourceTotal===null?null:currentRecords-sourceTotal, historyVerifiedAt:this.get('historyVerifiedAt',null), sourceLastSync: this.get('sourceLastSync', null), backfillCursor: this.get('backfillCursor', null), startedAt: this.get('startedAt', new Date().toISOString()), archived: Number(this.db.prepare('SELECT COUNT(*) AS n FROM posts').get()!.n), earliest: (this.db.prepare('SELECT MIN(created_at) AS d FROM posts').get()!.d as string) || null, coverageDays: Number(this.db.prepare('SELECT COUNT(*) AS n FROM coverage').get()!.n) }
  }
}
