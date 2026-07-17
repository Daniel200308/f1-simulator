import { hashNoise } from "@/simulation/random";

export type SessionMessagePhase = "PRACTICE" | "QUALIFYING";
export type SessionMessageOutcome = "COMPLETE" | "ADVANCED" | "ELIMINATED" | "NO RUN";
export type RaceRadioSituation =
  | "TYRE_WEAR"
  | "TYRE_HOT"
  | "TYRE_COLD"
  | "ATTACK_ENERGY"
  | "ATTACK_TYRE"
  | "DIRTY_AIR"
  | "BALANCE"
  | "DEFENDING"
  | "STABLE"
  | "RAIN_STARTING"
  | "RAIN_INTENSIFYING"
  | "RAIN_EASING"
  | "LOCAL_SHOWER"
  | "RAIN_RUNNING"
  | "WET_GRIP"
  | "AQUAPLANING"
  | "DRYING_LINE"
  | "INTER_CROSSOVER";

interface SessionMessageContext {
  seed: number;
  carIndex: number;
  sessionIndex: number;
  session: string;
  phase: SessionMessagePhase;
  outcome: SessionMessageOutcome;
  driverShortName: string;
  position: number | null;
  laps: number;
  gapSeconds: number;
  balanceIssue: string;
  tyreConditionPercent: number;
  aeroBalancePercent: number;
  mechanicalBalancePercent: number;
  thermalMarginPercent: number;
  bestLapSeconds: number | null;
}

interface RaceDriverRadioContext {
  seed: number;
  tick: number;
  carIndex: number;
  situation: RaceRadioSituation;
  metric?: string;
}

const DRIVER_OPENERS = [
  "Okay, I have a proper read on it now.",
  "Right, that run finally told us something.",
  "The car was honest once the tyres settled.",
  "I found the limit without having to force it.",
  "That was much more representative from my side.",
  "We have a useful baseline now.",
  "I could repeat the same feeling lap after lap.",
  "The last few laps were the clearest ones.",
  "I can separate the tyre from the car now.",
  "The balance came to me once the track improved.",
  "That felt like the real car, not just track evolution.",
  "I know where the lap time is hiding now.",
] as const;

const DRIVER_QUALIFYING_OPENERS = [
  "That push lap was committed from the first sector.",
  "I used nearly everything the tyre gave me.",
  "The preparation lap put the grip in the right place.",
  "I trusted the car enough to attack the quick section.",
  "The final run was cleaner than the banker.",
  "I could place the car exactly where I wanted.",
  "The grip arrived right on the push lap.",
  "The lap built properly through the opening sectors.",
  "The platform stayed underneath me when I released the brake.",
  "I found a clear limit rather than a surprise.",
  "That was a tidy lap, even if it was not perfect.",
  "I got the important corners connected this time.",
] as const;

const DRIVER_REQUESTS = [
  "Let us change one thing, not the whole car.",
  "Give me a small step and I will confirm it straight away.",
  "Keep the good part and work on the corner that is costing us.",
  "I want one clean comparison before we commit.",
  "Let us check the entry-to-exit trade before going further.",
  "There is room for one setup step without losing the baseline.",
  "I would rather make it repeatable than chase a magic lap.",
  "Make the next change easy to feel from the cockpit.",
  "Do not fix it with tyre preparation alone; the balance is still there.",
  "We can be a little braver, but only in the weak corner group.",
  "I would leave the strong axle alone for the next run.",
  "Let us compare both cars before we touch a second parameter.",
] as const;

const ENGINEER_OPENERS = [
  "Copy, the traces agree with the driver.",
  "That is a clean read from the data.",
  "The useful laps all tell the same story.",
  "The final run gave us the clearest comparison.",
  "We have a repeatable balance trend now.",
  "Track evolution is no longer hiding the car response.",
  "Long-run and low-fuel data point the same way.",
  "The tyre and platform channels line up.",
  "Sector three confirms the main limitation.",
  "The two cars have narrowed the setup window.",
  "Nothing random in that trace; the issue repeats.",
  "The lap time and steering trace finally correlate.",
] as const;

const ENGINEER_ACTIONS = [
  "We will move one parameter and check the first timed lap.",
  "Keep this baseline and run a clean A/B comparison.",
  "The next release needs cleaner air before another setup change.",
  "Use a short correlation run before loading the long-run fuel.",
  "Leave the strong corner group alone and work on the limitation.",
  "Carry the direction forward, but keep an eye on the thermal margin.",
  "Aim for a platform the driver can repeat, not one peak lap.",
  "Check steering, ride and temperature together before release.",
  "One click is enough for the next question; two would hide the answer.",
  "Let the sister car confirm the direction before we commit both setups.",
  "The hint is in the axle balance, not in a wholesale reset.",
  "We can trade a little strength from the good phase into the weak one.",
] as const;

type SetupVoice = "FRONT" | "DRAG" | "PLATFORM" | "REAR" | "COOLING" | "COOLING_DRAG" | "BALANCED";

const SETUP_VOICES: Readonly<Record<SetupVoice, { driver: readonly string[]; engineer: readonly string[] }>> = {
  FRONT: {
    driver: [
      "I need a second bite of steering through Copse",
      "the front washes wide when the speed stays in the car",
      "Maggotts asks for more front authority than I have",
      "the quick entries are making me wait before I can commit",
      "I am opening the steering too early to save the front tyre",
      "the car rotates in the slow stuff, then runs out of nose at speed",
    ],
    engineer: [
      "steering load keeps building through the fast sequence, so a little more front authority is available",
      "the front axle saturates first at Copse while the rear stays calm",
      "high-speed minimum speed is limited by the first steering response",
      "the aero trace loses rotation before mechanical grip becomes the limit",
      "the driver is waiting on front bite rather than traction",
      "the quick-corner loss points to balance, not tyre preparation",
    ],
  },
  DRAG: {
    driver: [
      "the car is planted, but it feels expensive down Hangar Straight",
      "I am reaching the straight with good traction and still losing speed",
      "the balance is safe, although the car feels heavy in a straight line",
      "I can attack the corners, but we are carrying too much resistance",
      "the platform is secure and the top speed is not coming with it",
      "I have confidence in the fast corners, maybe more than we need",
    ],
    engineer: [
      "corner stability is healthy, but the speed trace shows an avoidable drag cost",
      "the car exits well and gives the gain back before the braking zone",
      "aero security is above the level the lap currently needs",
      "the straight-line loss is larger than the cornering gain",
      "the rear platform is settled enough to consider a small trim",
      "top-speed deficit remains after traction and deployment are removed from the comparison",
    ],
  },
  PLATFORM: {
    driver: [
      "the car takes a moment to settle when I change direction",
      "I get the first response, then the platform keeps moving underneath me",
      "the quick left-right sequence is asking for more support",
      "I am correcting the car after the initial turn rather than flowing through it",
      "the platform feels lazy when the load moves from one side to the other",
      "I can live with the grip, but not with how long the car takes to settle",
    ],
    engineer: [
      "ride movement continues after the steering input, so the platform needs a touch more support",
      "the direction-change trace is slower than the tyre response",
      "body control, rather than aero load, is costing the sequence",
      "the second steering input arrives before the platform is ready",
      "the car has grip but spends too long transferring it across the chassis",
      "the ride trace points to a measured mechanical step, not more wing",
    ],
  },
  REAR: {
    driver: [
      "the rear snaps when I touch the kerb and release the brake",
      "I have rotation, but it arrives too suddenly on corner entry",
      "the car is lively over the kerbs and I cannot lean on the rear",
      "I am protecting the rear axle before I get back to power",
      "the slow entries are giving me a sharper response than I asked for",
      "I can catch the car, but the correction is costing the exit",
    ],
    engineer: [
      "rear load drops quickly over the kerb, suggesting compliance before more aero",
      "entry rotation is strong and the rear support disappears too abruptly",
      "the correction after brake release is the main mechanical loss",
      "the rear axle needs a calmer response across the kerb phase",
      "traction is being compromised by the way rotation arrives",
      "the platform is firm enough that the rear tyre cannot follow the surface cleanly",
    ],
  },
  COOLING: {
    driver: [
      "the temperatures are climbing before I finish the representative lap",
      "I have the balance, but the car will not hold it once the heat builds",
      "the thermal warning comes in just as I start to push",
      "I am managing the car earlier than the tyres need",
      "the power unit heat is beginning to dictate the run",
      "I can repeat the lap only if I back out of the loaded section",
    ],
    engineer: [
      "the thermal margin disappears before the balance does, so the bodywork is the first question",
      "temperature rise is limiting the programme earlier than tyre life",
      "the car is aerodynamically usable but thermally too tight for a repeat run",
      "power-unit protection is arriving before the target lap count",
      "the heat curve points to a small cooling concession rather than a pace reset",
      "thermal headroom is the limiting setup channel on this run",
    ],
  },
  COOLING_DRAG: {
    driver: [
      "the temperatures are easy and the car feels a little blunt on the straight",
      "I have plenty of thermal margin and not enough free speed",
      "the car stays cool even when I push, so we may be carrying spare opening",
      "nothing is hot, but the straight-line response feels lazy",
      "I am not using the cooling margin we built into this run",
      "the car is comfortable over a stint and a touch too conservative in the bodywork",
    ],
    engineer: [
      "thermal margin is generous while the speed trace still pays a bodywork cost",
      "the cooling curve is flat enough to recover a little efficiency",
      "temperature control is stronger than the current programme requires",
      "we can question the opening before adding any more aero load",
      "the thermal model shows unused headroom and a small drag penalty",
      "the car can afford a modest efficiency step without compromising protection",
    ],
  },
  BALANCED: {
    driver: [
      "the car is neutral enough that I can focus on the tyre",
      "nothing is shouting at me; the lap is mostly about execution now",
      "the balance stays with me from entry to traction",
      "I can place the car without making a correction",
      "the platform is predictable in both the slow and fast corners",
      "the setup is in the window and the remaining loss feels small",
    ],
    engineer: [
      "both axles remain inside the working window, so the baseline deserves protecting",
      "the trace has no dominant balance failure and the remaining gain is in execution",
      "mechanical and aero response are well matched across the lap",
      "the car is predictable enough to use tyre preparation as the next variable",
      "the two cars agree that this is a stable reference",
      "the setup is not hiding a large loss, so changes should stay deliberately small",
    ],
  },
};

const RADIO_OPENERS = [
  "Okay, understood.",
  "Copy, I can feel it.",
  "Right, the picture is clear.",
  "Understood from the cockpit.",
  "Yes, I have the same read.",
  "Copy that, confirming.",
  "That matches what I am feeling.",
  "Okay, I am on it.",
  "Understood, one point from me.",
  "Yep, I can work with that.",
  "Copy, let me manage it.",
  "All understood here.",
  "Yeah, I was just about to report that.",
  "Okay guys, quick update from the car.",
  "Yep, that is changing quite quickly now.",
  "Right, listen, this is what I have got.",
] as const;

const RADIO_OBSERVATIONS: Record<RaceRadioSituation, readonly string[]> = {
  TYRE_WEAR: [
    "the rear grip is dropping away through the high-speed change",
    "the fronts are sliding before I can get back to power",
    "the tyre has lost the support I had at the start of the stint",
    "I am reaching the limit earlier in every braking zone",
    "the balance is moving each lap as the surface opens up",
    "traction is fading and I am using more road on exit",
  ],
  TYRE_HOT: [
    "the tyre temperatures are climbing and the grip is starting to smear",
    "I am overheating the surface when I follow closely",
    "the rear axle is getting too hot through the long loaded corners",
    "the fronts are above the window after the traffic phase",
    "I am losing the tyre after one committed sequence",
    "the peak temperature is taking the precision out of the car",
  ],
  TYRE_COLD: [
    "I still cannot switch the tyre on in the opening sector",
    "the front axle is below the window when I arrive at the first push corner",
    "the grip is delayed after every slow section",
    "the tyre needs another loaded sequence before it responds",
    "I have very little bite until the lateral load builds",
    "the coldest corner is keeping me from committing on entry",
  ],
  ATTACK_ENERGY: [
    "deployment is dropping before the end of the straight",
    "the battery is not supporting the full attack phase",
    "I am losing electrical assistance at the point I need to complete the move",
    "the energy target is too aggressive to repeat every lap",
    "I have the pace but not enough deployment to finish the straight",
    "the attack is strong early and empty late in the lap",
  ],
  ATTACK_TYRE: [
    "this attack phase is taking too much from the tyre",
    "I can do the lap time but the tyre will not sustain it",
    "the grip peak is good and then falls away very quickly",
    "I am using the rear tyre faster than the current stint target",
    "the pace is there but the thermal cost is too high",
    "I can keep pushing only if we accept a shorter stint",
  ],
  DIRTY_AIR: [
    "I am losing the front as soon as I pick up the car ahead",
    "the dirty air is taking away the rotation through the fast sequence",
    "I can close on the straight but the front washes out in the corner",
    "the gap is close and I still need a cleaner exit to attack",
    "I cannot stay on the same line without overheating the fronts",
    "the wake is making the car unpredictable at turn-in",
  ],
  BALANCE: [
    "the balance is moving toward oversteer as the stint develops",
    "I have a small front limitation but the car remains predictable",
    "the rear is more nervous when I release the brake",
    "mid-corner rotation is good but I am paying for it on traction",
    "the platform is stable in the quick changes and weak in the slow exits",
    "the wind shift is changing the entry balance more than expected",
  ],
  DEFENDING: [
    "the car behind is close enough that I need to protect the inside",
    "I can defend this if we keep the energy available for the straight",
    "they are strong on exit and I need a better deployment profile",
    "I am covering the obvious move without compromising the next corner",
    "the pressure is building but the car is still under control",
    "I need the gap information early so I can position the car",
  ],
  STABLE: [
    "track position is stable and the car is behaving consistently",
    "the pace is sustainable without overworking the tyre",
    "I have a repeatable balance and can extend this phase",
    "the grip is reasonable and I am staying inside the target",
    "the car is predictable enough to respond if the situation changes",
    "the stint is under control and I still have margin to push",
  ],
  RAIN_STARTING: [
    "I have drops on the visor now and the braking points are starting to move",
    "it is definitely raining in this part of the circuit, but the grip has not gone yet",
    "the surface has gone shiny through the fast section and I am losing the reference",
    "I can feel the first bit of moisture at corner entry, especially off line",
    "the rain is picking up around me and the rear is beginning to move",
    "I have light rain here; grip is still there but it is changing every corner",
    "the windscreen is wet now and the kerbs are getting slippery before the racing line",
    "there are proper drops in the fast direction changes now, so the next lap will not feel the same",
  ],
  RAIN_INTENSIFYING: [
    "this has gone from a few drops to proper rain in less than a lap",
    "the rain is building very quickly and the braking grip is dropping corner by corner",
    "it is suddenly much heavier here; I am losing the front as soon as I turn in",
    "the cell has arrived all at once and the dry line is disappearing",
    "rain intensity is climbing fast and traction is already worse than the last sector",
    "this is getting heavy now; we need to be ready to change tyre immediately",
  ],
  RAIN_EASING: [
    "the rain is easing here and I can see the racing line beginning to come back",
    "it has backed off a lot; the grip is still low but the fresh water is clearing",
    "the drops are much lighter now and the braking references are stabilising",
    "this cell is passing; I am finding more traction each corner",
    "rain intensity is falling and the tyre is starting to feel too soft on line",
    "it is nearly stopped in this sector, though the surface is still holding water",
  ],
  LOCAL_SHOWER: [
    "it is raining only where I am; the other side of the lap still looks dry",
    "this sector is wet but the next one looks completely different",
    "I have a local shower here and a dry track just beyond it",
    "the grip split around the lap is massive; this part is much wetter",
    "rain is sitting over this section only, so one tyre will be a compromise",
    "I am driving through a narrow rain cell and the conditions change within seconds",
  ],
  RAIN_RUNNING: [
    "the intermediate is working, but the grip changes every time the rain gets heavier",
    "I have decent traction on this tyre, though the braking zones are still moving around",
    "the car is manageable in the wet now, but visibility in the spray is getting worse",
    "I can push on this tyre if I stay on the rubbered line and keep off the standing water",
    "the wet balance is okay; the rear only moves when I cross the streams of water",
    "I have confidence in the medium-speed corners, but the fast entries are still unpredictable",
    "the tyre is in the window now and the main problem is seeing the apex through the spray",
    "I can hold this pace in the rain, although the surface is changing from sector to sector",
  ],
  WET_GRIP: [
    "these dry tyres are not clearing the water and I cannot lean on the front axle",
    "the rear is stepping out wherever the water crosses the racing line",
    "I have no traction out of the slow corners and the braking phase is getting longer",
    "the grip is disappearing in patches; one corner is okay and the next one is gone",
    "I am tiptoeing through the wet section because the dry tyre has stopped working there",
    "the car is moving on all four tyres now, especially when I touch the painted lines",
    "I can keep it on the road, but this is no longer a proper dry-tyre lap",
    "the front locks as soon as I reach the damp braking zone and the rear follows it around",
  ],
  AQUAPLANING: [
    "I am aquaplaning on the straight and the steering is going completely light",
    "there is too much standing water; the car is floating before the braking zone",
    "I cannot see the car ahead and I am losing contact with the road at full speed",
    "the puddle at the end of the straight is pulling the car sideways every lap",
    "this is dangerous now, I have no response when I hit the deep water",
    "the floor is surfing over the water and I cannot keep a stable line",
    "visibility is almost zero in the spray and the car is aquaplaning off line",
    "I am lifting on the straight because the tyres cannot cut through the standing water",
  ],
  DRYING_LINE: [
    "the main line is drying quickly and these wet tyres are starting to overheat",
    "I can see a dry strip forming, but it is still wet as soon as I leave that line",
    "the tyre is moving around on the dry patches and the tread temperature is climbing",
    "there is proper grip on one narrow line now; everywhere else is still slippery",
    "the crossover is getting close because I am searching for water on the straights",
    "the circuit is coming back to us and the wet tyre feels too soft in the loaded corners",
    "I am cooling the tyre in the damp patches because the racing line is nearly dry",
    "the dry line is strong in this section, though the braking zones still have water",
  ],
  INTER_CROSSOVER: [
    "this feels right on the edge between a dry tyre and an intermediate now",
    "I have enough grip on line, but one small mistake puts me straight onto the wet surface",
    "the intermediate would help in the wet corners, although we would pay for it on the dry section",
    "the lap is split in two right now; dry grip in one sector and no confidence in the next",
    "I can survive on this tyre, but the crossover is getting closer every minute",
    "the braking zones say intermediate, while the fast line still says stay on the dry tyre",
    "I need the radar picture because the current grip could go either way in one lap",
    "the track is balanced right on the crossover and the next rain cell will decide it",
  ],
};

const RADIO_REQUESTS: Record<RaceRadioSituation, readonly string[]> = {
  TYRE_WEAR: ["We need to review the stop window.", "Give me the life target to the box lap.", "I need one management lap now.", "Tell me if we are extending."],
  TYRE_HOT: ["I need clean air or a cooling lap.", "Give me the temperature target.", "Let us open the gap for one lap.", "I will manage through the next sector."],
  TYRE_COLD: ["I need a stronger preparation instruction.", "Let me build load before the push.", "Give me one more lap to bring it in.", "I will work the brakes harder for temperature."],
  ATTACK_ENERGY: ["Tell me where to recharge.", "I need deployment for the next straight.", "Can we shorten the attack phase?", "Give me the battery target at the line."],
  ATTACK_TYRE: ["Confirm how long you need this pace.", "I need a revised stint target.", "Let me back it off for one lap.", "Tell me if track position is worth the cost."],
  DIRTY_AIR: ["I need a different approach to the car ahead.", "Give me the best overtake point.", "Let us build the gap and attack the exit.", "Tell me when the energy window is ready."],
  BALANCE: ["I can adjust tools if you give me the priority.", "Let us review the next corner sequence.", "I will try one click on the wheel.", "Tell me which axle is outside the model."],
  DEFENDING: ["Keep the gap calls coming.", "I need full deployment on the straight.", "Tell me if they commit early.", "I will hold the inside line."],
  STABLE: ["Let me know if the pace target changes.", "I can extend if the strategy needs it.", "I have margin for a short push phase.", "Keep me updated on the gaps."],
  RAIN_STARTING: ["Tell me how heavy the next cell is.", "Keep me posted on the cars ahead.", "I need the radar update before the next lap.", "Let us watch the crossover, it is coming quickly.", "Give me the wettest sector each lap."],
  RAIN_INTENSIFYING: ["We need the tyre call now.", "Tell me if this cell gets heavier again.", "Get the intermediates ready.", "Give me the crossover at pit entry.", "Watch the standing water ahead."],
  RAIN_EASING: ["Tell me if another cell is behind this one.", "Start checking the slick crossover.", "Give me the drying trend next lap.", "Watch anyone gambling on dry tyres.", "Keep me on the dampest line for cooling."],
  LOCAL_SHOWER: ["Give me the sector-by-sector radar.", "Do not judge the tyre from this sector alone.", "Tell me where the dry part begins.", "Compare this with my team-mate's report.", "I need the next cell direction."],
  RAIN_RUNNING: ["Keep updating me on the heaviest rain.", "Tell me if the standing water is increasing.", "I can stay out if this intensity holds.", "Give me the visibility reports from the cars ahead.", "Watch the tyre temperature while I manage the spray."],
  WET_GRIP: ["We need to talk about intermediates now.", "Tell me the crossover against the cars ahead.", "I cannot keep pushing like this on the dry tyre.", "Give me the safest braking target.", "If the rain stays, box me next lap."],
  AQUAPLANING: ["This needs reporting to race control.", "I need a safer pace instruction immediately.", "Check the standing-water level because this is too much.", "We should not be racing at this speed.", "Tell me if the safety car is being considered."],
  DRYING_LINE: ["Check the slick crossover for me.", "I need the dry-line trend over the next lap.", "Tell me where I can cool the tyre.", "Compare my sectors with the cars already on slicks.", "Do not leave me on this tyre once it overheats."],
  INTER_CROSSOVER: ["Give me the next two-minute radar picture.", "Compare the intermediate to staying out.", "I need a clear call before the pit entry.", "Watch the sector times of anyone who has stopped.", "Tell me if this rain is building or passing."],
};

function choice<T>(values: readonly T[], seed: number, stream: number, tick: number): T {
  return values[Math.floor(hashNoise(seed, stream, tick) * values.length) % values.length];
}

function setupVoiceFor(balanceIssue: string): SetupVoice {
  if (balanceIssue.includes("understeer")) return "FRONT";
  if (balanceIssue.includes("drag")) return balanceIssue.includes("cooling") ? "COOLING_DRAG" : "DRAG";
  if (balanceIssue.includes("platform movement")) return "PLATFORM";
  if (balanceIssue.includes("rear instability")) return "REAR";
  if (balanceIssue.includes("restricted cooling")) return "COOLING";
  return "BALANCED";
}

function tyreRead(tyreConditionPercent: number): string {
  if (tyreConditionPercent < 60) return "The tyre dropped away before the run was finished.";
  if (tyreConditionPercent < 76) return "The tyre stayed alive, but the final laps needed care.";
  return "The tyre remained consistent through the useful laps.";
}

function classificationRead(context: SessionMessageContext): string {
  if (context.position === null) return "We never put a representative lap on the board.";
  if (context.outcome === "ELIMINATED") return `P${context.position}; the final lap never came together.`;
  if (context.outcome === "ADVANCED") return `P${context.position} gets us through, with more in the car.`;
  if (context.position <= 3) return `P${context.position} is strong, so we should protect the good part.`;
  if (context.position <= 10) return `P${context.position}, ${context.gapSeconds.toFixed(3)}s off — close enough to improve with one clean step.`;
  return `P${context.position}, ${context.gapSeconds.toFixed(3)}s away — the limitation is costing us repeatedly.`;
}

export function buildSessionDriverMessage(context: SessionMessageContext): string {
  const stream = context.carIndex * 29 + context.sessionIndex * 11;
  if (context.outcome === "NO RUN") {
    return `We never got a proper lap in ${context.session}. Use the other car as the reference and give me one simple question next run.`;
  }
  const opener = choice(context.phase === "QUALIFYING" ? DRIVER_QUALIFYING_OPENERS : DRIVER_OPENERS, context.seed, stream + 2, 2).replace(/\.$/, "");
  const voice = SETUP_VOICES[setupVoiceFor(context.balanceIssue)];
  const observation = choice(voice.driver, context.seed, stream + 3, 3);
  const request = choice(DRIVER_REQUESTS, context.seed, stream + 4, 4);
  return `${opener} — ${observation}. ${classificationRead(context)} ${request}`;
}

export function buildSessionEngineerMessage(context: SessionMessageContext): string {
  const stream = context.carIndex * 31 + context.sessionIndex * 13;
  if (context.outcome === "NO RUN") {
    return `No representative lap for ${context.driverShortName} in ${context.session}. We will borrow the sister-car direction and keep the next release simple.`;
  }
  const opener = choice(ENGINEER_OPENERS, context.seed, stream + 5, 5).replace(/\.$/, "");
  const voice = SETUP_VOICES[setupVoiceFor(context.balanceIssue)];
  const observation = choice(voice.engineer, context.seed, stream + 6, 6);
  const tyre = tyreRead(context.tyreConditionPercent);
  const action = choice(ENGINEER_ACTIONS, context.seed, stream + 7, 7);
  return `${opener}: ${observation}. ${classificationRead(context)} ${tyre} ${action}`;
}

export function buildRaceDriverRadio(context: RaceDriverRadioContext): string {
  const stream = context.carIndex * 37 + Object.keys(RADIO_OBSERVATIONS).indexOf(context.situation) * 17;
  const opener = choice(RADIO_OPENERS, context.seed, stream + 7, context.tick);
  const observation = choice(RADIO_OBSERVATIONS[context.situation], context.seed, stream + 8, context.tick + 1);
  const request = choice(RADIO_REQUESTS[context.situation], context.seed, stream + 9, context.tick + 2);
  return `${opener} ${observation}${context.metric ? ` — ${context.metric}.` : "."} ${request}`;
}

export const SESSION_DEBRIEF_VARIANT_CAPACITY = Math.max(DRIVER_OPENERS.length, DRIVER_QUALIFYING_OPENERS.length)
  * Math.min(...Object.values(SETUP_VOICES).map((voice) => voice.driver.length))
  * DRIVER_REQUESTS.length;
export const RACE_DRIVER_RADIO_VARIANT_CAPACITY = RADIO_OPENERS.length
  * Math.min(...Object.values(RADIO_OBSERVATIONS).map((values) => values.length))
  * Math.min(...Object.values(RADIO_REQUESTS).map((values) => values.length));
