import { describe, expect, test } from "bun:test";
import { canonicalizeFeed } from "../worker/index.ts";
import type { LiveFeed } from "../src/domains/live/types.ts";

const feed: LiveFeed = {
  race_id: 5619,
  series_id: 1,
  run_name: "Brickyard 400",
  track_id: 206,
  track_name: "Iowa Speedway",
  lap_number: 160,
  laps_in_race: 160,
  laps_to_go: 0,
  elapsed_time: 0,
  flag_state: 9,
  vehicles: [],
};

describe("Worker feed identity", () => {
  test("canonicalizes hybrid CDN metadata from the matching schedule race", () => {
    const result = canonicalizeFeed(feed, [
      {
        race_id: 5619,
        run_type: 1,
        race_name: "Brickyard 400 presented by PPG",
        track_id: 123,
        track_name: "Indianapolis Motor Speedway",
      },
      {
        race_id: 5619,
        run_type: 3,
        race_name: "Brickyard 400 presented by PPG",
        track_id: 123,
        track_name: "Indianapolis Motor Speedway",
      },
    ]);

    expect(result.run_name).toBe("Brickyard 400 presented by PPG");
    expect(result.track_id).toBe(123);
    expect(result.track_name).toBe("Indianapolis Motor Speedway");
    expect(result.lap_number).toBe(160);
  });

  test("leaves the feed untouched when the schedule has no matching race", () => {
    expect(canonicalizeFeed(feed, [{ race_id: 9999 }])).toBe(feed);
  });
});
