import { describe, expect, test } from "bun:test";
import { processFeed } from "../src/domains/live/runtime.ts";
import type { LiveAlertEvent, LiveBaselines, LiveFeed, LiveVehicle } from "../src/domains/live/types.ts";
import liveFeed from "./fixtures/live-feed.json";

const feed = liveFeed as unknown as LiveFeed;

const baselines: LiveBaselines = {
  seriesId: 2,
  bucketWidth: 5,
  passEffByBucket: { "1": 0.5 },
  closerByBucket: { "1": 0.2 },
};

// A minimal live (green-flag) feed with the given running order.
function mkFeed(order: Array<{ id: number; pos: number }>, over: Partial<LiveFeed> = {}): LiveFeed {
  const vehicles: LiveVehicle[] = order.map(({ id, pos }) => ({
    running_position: pos,
    vehicle_number: String(pos),
    driver: { driver_id: id, full_name: `Driver ${id}` },
    delta: pos === 1 ? 0 : pos * 0.5,
    average_running_position: pos,
    status: 1,
    is_on_track: true,
  }));
  return {
    race_id: 42,
    series_id: 1,
    run_name: "Test 400",
    lap_number: 100,
    laps_in_race: 200,
    laps_to_go: 100,
    elapsed_time: 0,
    flag_state: 1, // green → live
    vehicles,
    ...over,
  };
}

describe("processFeed", () => {
  test("enriches drivers and stamps the payload", () => {
    const { payload, snapshot } = processFeed(feed, {
      baselines,
      prevSnapshot: null,
      fetchedAt: 1700000000000,
    });
    expect(payload.ok).toBe(true);
    expect(payload.live).toBe(snapshot.isLive); // fixture is "cold" → not live
    expect(payload.live).toBe(false);
    expect(payload.fetchedAt).toBe(1700000000000);
    expect(payload.snapshot.drivers.length).toBe(38);

    const bj = payload.snapshot.drivers.find((d) => d.driverId === 4085)!;
    expect(bj.livePassEfficiency).toBeCloseTo(43 / 67, 6); // enrichment ran

    // one prediction per running car
    const running = payload.snapshot.drivers.filter((d) => d.running).length;
    expect(payload.pitCycles.length).toBe(running);

    expect(payload.alerts).toEqual([]); // no prev snapshot → no diff
  });

  test("first tick has no alerts; second tick prepends new events and carries state forward", () => {
    const a = processFeed(mkFeed([{ id: 1, pos: 1 }, { id: 2, pos: 2 }]), {
      baselines,
      prevSnapshot: null,
      fetchedAt: 1,
    });
    expect(a.newAlerts).toEqual([]);
    expect(a.payload.live).toBe(true);

    // Driver 2 takes the lead.
    const b = processFeed(mkFeed([{ id: 2, pos: 1 }, { id: 1, pos: 2 }]), {
      baselines,
      prevSnapshot: a.snapshot,
      prevAlerts: a.payload.alerts,
      fetchedAt: 2,
    });
    expect(b.newAlerts.some((e) => e.kind === "lead_change" && e.driverId === 2)).toBe(true);
    // Newest events sit at the front of the rolling feed.
    expect(b.payload.alerts[0]!.kind).toBe("lead_change");
  });

  test("caps the rolling alert feed at maxAlerts, newest first", () => {
    const prevAlerts: LiveAlertEvent[] = Array.from({ length: 50 }, (_, i) => ({
      kind: "pit",
      atLap: i,
      message: `old ${i}`,
      driverId: null,
      carNumber: null,
      fromPosition: null,
      toPosition: null,
    }));
    const { payload } = processFeed(mkFeed([{ id: 2, pos: 1 }, { id: 1, pos: 2 }]), {
      baselines,
      prevSnapshot: processFeed(mkFeed([{ id: 1, pos: 1 }, { id: 2, pos: 2 }]), {
        baselines,
        prevSnapshot: null,
        fetchedAt: 1,
      }).snapshot,
      prevAlerts,
      maxAlerts: 10,
      fetchedAt: 2,
    });
    expect(payload.alerts.length).toBe(10);
    expect(payload.alerts[0]!.kind).toBe("lead_change"); // the new event is first
  });
});
