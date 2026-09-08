// How the model works + the honesty bar. The prose mirrors the web
// methodology page; the *numbers* are read from the server (they ride along
// with GET /api/predictions) so the app can never quote a backtest the model
// no longer earns. Free to read on purpose — a claim of accuracy that only
// paying users can check is not a claim worth making.
import { useCallback, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useFocusEffect } from "expo-router";
import { serverBase } from "../../lib/config.ts";
import { Card, Loading, Screen } from "../../ui/components.tsx";
import { colors } from "../../ui/theme.ts";
import { fetchPredictions, type Methodology } from "./api.ts";

export function MethodologyScreen() {
  const [backtest, setBacktest] = useState<Methodology | null | undefined>(undefined);

  const load = useCallback(async () => {
    const data = await fetchPredictions(await serverBase());
    setBacktest(data?.methodology ?? null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (backtest === undefined) void load();
    }, [backtest, load]),
  );

  if (backtest === undefined) return <Loading />;

  return (
    <Screen>
      <Card title="How predictions work">
        <Text style={styles.body}>
          Each driver gets a rating in finish-position units built only from races before the
          target race: trailing-5 average finish, average finish at this track type, recent
          loop-data Driver Rating, DNF rate, and the starting position once qualifying has run.
        </Text>
        <Text style={styles.body}>
          We then simulate the race 5,000 times — every run draws a score around each rating with a
          track-type-calibrated spread (superspeedways are near-lotteries; road courses follow
          form) and sorts the field. The published probabilities are simply the simulation
          frequencies.
        </Text>
        <Text style={styles.body}>
          Thursday runs use form only; Saturday runs add the qualifying grid, and the Saturday run
          is the last word before the green flag. After the race, the board shows what the model
          said next to what happened.
        </Text>
      </Card>

      <Card title="The honesty bar">
        {backtest ? (
          <Text style={styles.body}>
            The model only ships because it clears the spec's honesty bar on a held-out{" "}
            {backtest.evalSeason} season it never trained on: it beats both a uniform baseline and a
            trailing-5-average-finish baseline by Brier score (win {backtest.winBrier}; top-10{" "}
            {backtest.top10Brier}). {backtest.calibrationNote}
          </Text>
        ) : (
          <Text style={styles.body}>
            The backtest numbers come from the server and it could not be reached. Pull to retry
            from the predictions screen.
          </Text>
        )}
        <Text style={styles.body}>
          Entry lists are inferred from the last three completed races, so a one-off entry can be
          missed until qualifying. Predictions are information, not gambling advice — we take no
          bets and republish no sportsbook odds.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 10 },
});
