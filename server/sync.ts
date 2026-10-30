import type { ArchiveStore } from './archive.ts';
import { randomUUID } from 'node:crypto';
import { assertPosts, normalizePost, object, safePolymarketURL, DAY } from './domain.ts';
import type { Tracking } from '../src/lib/types.ts';
import { setTimeout as delay } from 'node:timers/promises';
const BASE = 'https://xtracker.polymarket.com/api';
export class Collector {
    busy = false;
    stopped = false;
    deadline = Infinity;
    store: ArchiveStore;
    constructor(store: ArchiveStore) { this.store = store; }
    async get(path: string, params: Record<string, string> = {}) {
        const url = new URL(BASE + path);
        for (const [key, value] of Object.entries(params))
            url.searchParams.set(key, value);
        let response: Response | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
            if (this.stopped || Date.now() > this.deadline)
                throw new Error('采集服务正在停止');
            try {
                response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', 'User-Agent': 'MuskTracker/0.1' } });
            }
            catch (error) {
                if (attempt === 2) {
                    const cause = error instanceof Error ? error.cause as {
                        code?: string;
                    } | undefined : undefined;
                    throw new Error(`连接 XTracker 失败，已重试 2 次${cause?.code ? `（${cause.code}）` : ''}`);
                }
                await delay(500 * 2 ** attempt);
                continue;
            }
            if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
                const retryAfter = Number(response.headers.get('retry-after'));
                await response.body?.cancel();
                await delay(Math.min(5000, Math.max(500 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0)));
                continue;
            }
            break;
        }
        if (!response)
            throw new Error('未收到 XTracker 响应');
        if (!response.ok)
            throw new Error(`XTracker HTTP ${response.status}`);
        const body = object(await response.json());
        if (body.success !== true || body.data === undefined)
            throw new Error(typeof body.error === 'string' ? body.error : 'XTracker 返回了无效响应');
        return body.data;
    }
    async slice(start: number, end: number): Promise<void> {
        const data = await this.get('/users/elonmusk/posts', { platform: 'X', startDate: new Date(start).toISOString(), endDate: new Date(end).toISOString() });
        const posts = assertPosts(data, start, end);
        // Small slices reduce risk of undocumented response caps. Preserve inclusive edges.
        if (posts.length >= 100) {
            if (end - start < 1000)
                throw new Error('单秒结果达到 100 条，无法验证分页完整性');
            const mid = Math.floor((start + end) / 2);
            await this.slice(start, mid);
            await this.slice(mid + 1, end);
            return;
        }
        await this.store.ingest(posts, start, end);
    }
    async sync() {
        if (this.busy || this.stopped)
            return;
        this.busy = true;
        this.deadline = Date.now() + 210_000;
        const lease = randomUUID();
        let locked = false;
        let run: string | number | bigint | undefined;
        const started = new Date().toISOString();
        try {
            locked = await this.store.acquireLease(lease, 55_000);
            if (!locked) return;
            await this.store.set('state', 'syncing');
            await this.store.set('lastAttempt', started);
            run = await this.store.startRun(started);
            const user = object(await this.get('/users/elonmusk', { platform: 'X' }));
            if (typeof user.handle !== 'string' || user.handle.toLowerCase() !== 'elonmusk')
                throw new Error('XTracker 返回的用户不是 elonmusk');
            await this.store.set('user', user);
            const count = user._count ? object(user._count).posts : null;
            await this.store.set('sourceTotal', typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null);
            await this.store.set('sourceLastSync', typeof user.lastSync === 'string' ? user.lastSync : typeof user.lastSyncedAt === 'string' ? user.lastSyncedAt : null);
            const trackingList = await this.get('/users/elonmusk/trackings', { platform: 'X', activeOnly: 'false' });
            if (!Array.isArray(trackingList))
                throw new Error('XTracker tracking 列表结构不符');
            let earliest = Date.now() - 30 * DAY;
            const oldTrackings = new Map((await this.store.trackings()).map(tracking => [tracking.id, tracking]));
            for (const value of trackingList) {
                const raw = object(value);
                if (typeof raw.id !== 'string' || typeof raw.startDate !== 'string' || typeof raw.endDate !== 'string' || !Number.isFinite(Date.parse(raw.startDate)) || !Number.isFinite(Date.parse(raw.endDate)))
                    throw new Error('市场周期缺少有效的 ID 或起止时间');
                earliest = Math.min(earliest, Date.parse(raw.startDate));
                const old = oldTrackings.get(raw.id);
                await this.store.saveTracking({ id: raw.id, title: typeof raw.title === 'string' ? raw.title : 'Elon Musk tweets', startDate: raw.startDate, endDate: raw.endDate, isActive: raw.isActive === true, url: safePolymarketURL(raw.marketLink ?? raw.polymarketUrl ?? raw.marketUrl ?? raw.url), official: old?.official ?? null, local: 0, checkedAt: old?.checkedAt ?? null, raw });
            }
            // The API documents an unbounded posts endpoint. Reconcile it to the user
            // total before trusting coverage; otherwise continue bounded backfill.
            const lastFull = await this.store.get<number>('lastFullAttempt', 0);
            if (Date.now() - lastFull > 3600000) {
                const full = await this.get('/users/elonmusk/posts', { platform: 'X' });
                if (!Array.isArray(full))
                    throw new Error('全量 posts 响应不是数组');
                const unique = Array.from(new Map(full.map(v => { const p = normalizePost(v); return [p.id, p] as const; })).values());
                const fetchedAt = Date.now();
                if (unique.some(p => Date.parse(p.createdAt) > fetchedAt))
                    throw new Error('全量响应包含未来时间的记录');
                if (typeof count === 'number' && unique.length === count) {
                    const previousEarliest = (await this.store.status()).earliest;
                    const earliestSeen = Math.min(previousEarliest ? Date.parse(previousEarliest) : fetchedAt, ...unique.map(p => Date.parse(p.createdAt)));
                    const start = Math.floor(earliestSeen / DAY) * DAY;
                    await this.store.ingest(unique, start, fetchedAt);
                    await this.store.set('historyVerifiedAt', new Date(fetchedAt).toISOString());
                    await this.store.set('backfillFloor', start);
                    earliest = Math.min(earliest, start);
                }
                else if (unique.length) {
                    earliest = Math.min(earliest, ...unique.map(p => Date.parse(p.createdAt)));
                }
                await this.store.set('lastFullAttempt', fetchedAt);
            }
            // On each run revisit a 48-hour overlap, preserving late imports and corrections.
            const now = Date.now();
            const midnight = Math.floor(now / DAY) * DAY;
            for (let start = midnight - 2 * DAY; start <= midnight; start += DAY)
                await this.slice(start, Math.min(start + DAY - 1, now));
            if (!await this.store.get('backfillCursor', null))
                await this.store.set('backfillCursor', new Date(midnight - DAY * 3).toISOString());
            await this.store.set('backfillFloor', Math.floor(earliest / DAY) * DAY);
            // Reconcile the source counter separately from the local archive.
            const selected = (await this.store.trackings()).filter(t => Date.parse(t.endDate) >= now - 7 * DAY).sort((a, b) => Date.parse(b.endDate) - Date.parse(a.endDate)).slice(0, 20);
            for (const tracking of selected) {
                const detail = object(await this.get(`/trackings/${encodeURIComponent(tracking.id)}`, { includeStats: 'true' }));
                const stats = detail.stats ? object(detail.stats) : {};
                tracking.official = typeof stats.total === 'number' && Number.isFinite(stats.total) ? stats.total : null;
                tracking.checkedAt = new Date().toISOString();
                tracking.raw = detail;
                tracking.url = safePolymarketURL(detail.marketLink) ?? tracking.url;
                await this.store.saveTracking(tracking);
            }
            await this.store.set('observedThrough', now);
            await this.store.set('lastSuccess', new Date().toISOString());
            await this.store.set('error', null);
            await this.store.set('state', 'idle');
            await this.store.finishRun(run!, 'success');
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (locked) {
                await this.store.set('error', message);
                await this.store.set('state', 'error');
                if (run !== undefined) await this.store.finishRun(run, 'error', message);
            }
            console.error('[sync]', message);
        }
        finally {
            try { if (locked) await this.store.releaseLease(lease); }
            finally { this.busy = false; this.deadline = Infinity; }
        }
    }
    async backfill() {
        if (this.busy || this.stopped)
            return;
        this.busy = true;
        const lease = randomUUID();
        let locked = false;
        try {
            if (!await this.store.get('lastSuccess', null)) return;
            const cursor = await this.store.get<string | null>('backfillCursor', null);
            if (!cursor) return;
            const start = Date.parse(cursor), floor = await this.store.get('backfillFloor', start);
            if (start < floor) return;
            locked = await this.store.acquireLease(lease);
            if (!locked) return;
            if (!await this.store.covered(start, start + DAY - 1))
                await this.slice(start, start + DAY - 1);
            await this.store.set('backfillCursor', new Date(start - DAY).toISOString());
        }
        catch (error) {
            await this.store.set('error', error instanceof Error ? error.message : String(error));
            await this.store.set('state', 'error');
        }
        finally {
            try { if (locked) await this.store.releaseLease(lease); }
            finally { this.busy = false; }
        }
    }
}
