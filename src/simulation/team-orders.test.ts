import { describe, expect, it } from "vitest";

import { createInitialSnapshot, setTeamOrder, stepSnapshot } from "@/simulation/engine";

describe("team orders", () => {
  it("records hold and swap instructions for the two active player cars", () => {
    const initial = { ...createInitialSnapshot(520, "RUNNING"), elapsedTime: 20 };
    const hold = setTeamOrder(initial, "HOLD_POSITION");
    expect(hold.teamOrder).toMatchObject({ type: "HOLD_POSITION", leadCarId: expect.any(String), trailingCarId: expect.any(String) });
    expect(hold.radioMessages.filter((message) => message.message === "HOLD POSITION")).toHaveLength(2);

    const swap = setTeamOrder(hold, "SWAP_CARS");
    expect(swap.teamOrder.type).toBe("SWAP_CARS");
    expect(swap.teamOrder.leadCarId).not.toBe(swap.teamOrder.trailingCarId);
  });

  it("slows the leading team car and releases its teammate in a swap window", () => {
    const base = createInitialSnapshot(521, "RUNNING");
    const playerCars = base.cars.filter((car) => car.teamId === base.playerTeamId).sort((a, b) => a.racePosition - b.racePosition);
    const prepared = {
      ...base,
      elapsedTime: 60,
      cars: base.cars.map((car) => car.carId === playerCars[0].carId ? { ...car, totalDistance: 1_000, lapDistance: 1_000, currentSpeed: 210, currentLap: 2 }
        : car.carId === playerCars[1].carId ? { ...car, totalDistance: 990, lapDistance: 990, currentSpeed: 210, currentLap: 2 }
          : car),
    };
    const swapped = setTeamOrder(prepared, "SWAP_CARS");
    const next = stepSnapshot(swapped);
    const lead = next.cars.find((car) => car.carId === playerCars[0].carId)!;
    const trailing = next.cars.find((car) => car.carId === playerCars[1].carId)!;

    expect(lead.currentSpeed).toBeLessThan(trailing.currentSpeed);
  });
});
