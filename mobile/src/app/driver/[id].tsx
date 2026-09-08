import { useLocalSearchParams } from "expo-router";
import { DriverScreen } from "../../features/drivers/DriverScreen.tsx";
import { ErrorNote, Screen } from "../../ui/components.tsx";

export default function DriverRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const driverId = Number.parseInt(id ?? "", 10);
  if (!Number.isFinite(driverId) || driverId <= 0) {
    return (
      <Screen>
        <ErrorNote message="Unknown driver." />
      </Screen>
    );
  }
  return <DriverScreen driverId={driverId} />;
}
