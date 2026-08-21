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
  | "LOW_GRIP"
  | "BRAKING_LOCKUP"
  | "REAR_SNAP"
  | "SPRAY_VISIBILITY"
  | "SPIN_RECOVERY"
  | "AQUAPLANING"
  | "DRYING_LINE"
  | "INTER_CROSSOVER"
  /* Frustration and approval: the driver reacting to the race, not reporting it. */
  | "SLOW_CAR_AHEAD"
  | "BLOCKED_ANGRY"
  | "STRATEGY_DOUBT"
  | "STRATEGY_APPROVAL"
  | "PIT_CALL_LATE"
  | "TRAFFIC_FRUSTRATION"
  | "FIRST_DROPS"
  | "CAR_HAPPY"
  | "PACE_COMPLAINT"
  | "POSITION_LOST"
  | "POSITION_GAINED"
  | "FINAL_LAPS_PUSH"
  | "SAFETY_CAR_DEPLOYED"
  | "SAFETY_CAR_BUNCHING"
  | "SAFETY_CAR_WAVE_BY"
  | "SAFETY_CAR_RESTART"
  | "VSC_DELTA"
  | "YELLOW_CONTROL"
  | "RED_FLAG_SUSPENSION"
  | "RED_FLAG_RESTART"
  | "CAR_AHEAD_CLOSING"
  | "CAR_AHEAD_PULLING_AWAY";

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
  /**
   * How strongly the driver is reacting. `HIGH` returns a short, emotional call
   * of the kind heard when something is actually happening; the default returns
   * the full considered read.
   */
  intensity?: "NORMAL" | "HIGH";
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

const QUALIFYING_ADVANCED_REACTIONS = [
  "Yes! We delivered that when the pressure came on.",
  "That is a proper response; I am really happy with that lap.",
  "Good, we are through. I had to commit fully to make that one stick.",
  "Come on! That lap had real bite when we needed it.",
  "That felt alive. I trusted it and the lap finally came together.",
  "We got it. The margin was uncomfortable, but the lap was honest.",
  "That is much more like us. I could attack instead of surviving it.",
  "Yes, that was satisfying. I found the rhythm at exactly the right moment.",
  "I am relieved, honestly. That final run carried a lot of pressure.",
  "Nice one. The car gave me confidence and I used every bit of it.",
  "That was intense, but we earned our place in the next session.",
  "I enjoyed that one. The grip arrived and I could finally lean on the car.",
] as const;

const QUALIFYING_ELIMINATED_REACTIONS = [
  "Damn it, that hurts. We had more pace than this result shows.",
  "No, that is brutal. I am angry because the lap was there for us.",
  "That is so frustrating. We cannot keep leaving the decisive lap this late.",
  "I am gutted. One messy sequence has knocked us out.",
  "That was rubbish from my side; I never joined the corners together.",
  "Honestly, that is painful. I was fighting the car instead of attacking the lap.",
  "Damn, we missed it. The preparation and the push never lined up.",
  "I hate going out like that. The potential was there and we did not use it.",
  "That is a horrible feeling. I knew the cut was moving and still could not answer it.",
  "I am really disappointed. We gave away too much before the final sector.",
  "No way, that is not good enough. We should have been safely through.",
  "That one stings. I pushed hard, but the lap fell apart underneath me.",
] as const;

const QUALIFYING_NO_TIME_REACTIONS = [
  "This is a disaster; we never even put a representative lap on the board.",
  "Damn it, no time is unacceptable. We let the whole session get away from us.",
  "I am furious. I never got one clean chance to show what the car could do.",
  "That is the worst way to go out. We had pace and no lap to prove it.",
  "Honestly, that was chaos. Every window closed before I could start a proper lap.",
  "No lap, no result. That is incredibly frustrating from inside the car.",
  "I cannot believe we finished without a time. We made the session far too difficult.",
  "That really hurts; all that preparation and we never reached the line with a valid lap.",
] as const;

const QUALIFYING_TOP_REACTIONS = [
  "Yes! That is a lap I can be proud of.",
  "Come on! I got everything out of it when it counted.",
  "That was special. The car and I were right on the limit together.",
  "Beautiful. I could feel every corner building toward the line.",
  "That is the qualifying lap we came here to deliver.",
  "I loved that. There was no hesitation anywhere on the lap.",
  "That felt properly quick. I committed and the car stayed with me.",
  "Yes, that is hugely satisfying. I left almost nothing out there.",
] as const;

const QUALIFYING_GRID_REACTIONS = [
  "I gave it everything, but I am still frustrated with where we have ended up.",
  "The lap was committed, though I wanted more from this grid position.",
  "I pushed as hard as I could. It is not the result I came here for.",
  "There were good corners in that lap, but not enough of them together.",
  "I am disappointed with the position, even if the final lap was cleaner.",
  "That was on the edge all the way around. I wish it had bought us more.",
  "We found some pace, but the result still feels tougher than it should.",
  "I cannot celebrate that position. We left too much time in the weak part of the lap.",
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

/**
 * How the driver felt about the run. Practice feedback is the driver talking
 * about the session they just drove, so the mood carries as much information as
 * the technical read: a car that is fighting them earns a genuinely irritated
 * reaction, and a car in the window earns an enthusiastic one.
 */
export type PracticeMood = "DELIGHTED" | "HAPPY" | "NEUTRAL" | "FRUSTRATED" | "ANGRY";

const PRACTICE_MOOD_OPENERS: Readonly<Record<PracticeMood, readonly string[]>> = {
  DELIGHTED: [
    "Yes! That run was genuinely enjoyable.",
    "I loved that. The car did exactly what I asked.",
    "That felt brilliant out there.",
    "Honestly, that was a pleasure to drive.",
    "Beautiful. I could attack every lap without thinking about it.",
    "That is the best this car has felt all weekend.",
    "Really happy with that one; the car and I are speaking the same language.",
    "Come on, that was strong. I was smiling in the cockpit.",
    "That run was a joy. I trusted the car everywhere.",
    "Fantastic feeling. I could push and the car stayed with me.",
    "I enjoyed every lap of that. Nothing surprised me.",
    "That was superb. Give me this car and I will fight anyone.",
  ],
  HAPPY: [
    "That was a good run, I am pleased with it.",
    "Okay, I liked that. The car is coming to me.",
    "That felt decent out there.",
    "Solid run from my side; the car is mostly doing what I want.",
    "I am fairly happy with that one.",
    "That was encouraging. I could lean on the car more each lap.",
    "Good session. Nothing frightening, and the pace is there.",
    "I felt comfortable in that. We are close now.",
    "That is a car I can work with.",
    "Positive run. I could build the lap properly.",
    "Happy enough with that. The car is behaving.",
    "That was clean and predictable, I will take it.",
  ],
  NEUTRAL: [
    "Okay, that run was reasonable.",
    "Mixed feelings about that one.",
    "That was fine, nothing special.",
    "The run was okay; the car is neither helping nor fighting me.",
    "Alright, I have a read on it now.",
    "It was an average run, honestly.",
    "That was acceptable. There is more in it.",
    "The car is in a workable place, not a good one yet.",
    "Nothing dramatic out there, good or bad.",
    "I can drive around it, but I am not enjoying it much.",
    "That was serviceable. I want more from the next run.",
    "The lap is there, the feeling is not quite yet.",
  ],
  FRUSTRATED: [
    "That was frustrating, I have to be honest.",
    "I did not enjoy that run at all.",
    "The car is not listening to me out there.",
    "That was hard work for very little.",
    "Honestly, I am fighting this car every lap.",
    "That run annoyed me. I cannot trust what the car does.",
    "I am working far too hard for that lap time.",
    "The car keeps arguing with me in the corners.",
    "That was scrappy, and it is not coming from me.",
    "I am not comfortable. The car does what it wants, not what I ask.",
    "That was a struggle from the first lap to the last.",
    "Not good. I am correcting the car instead of driving it.",
  ],
  ANGRY: [
    "That was horrible. The car is completely against me.",
    "No, this is unacceptable. I cannot drive it like this.",
    "That run was a mess and I am angry about it.",
    "I hated every lap of that. The car is undriveable.",
    "This is nowhere near good enough. I have no confidence at all.",
    "That was awful. I am wrestling the car and losing.",
    "Seriously, this car is fighting me everywhere. Fix it.",
    "I am furious with that. There is nothing I can do with this balance.",
    "That was dreadful. I cannot commit to a single corner.",
    "No confidence, no grip, no idea where the limit is. That was terrible.",
    "That is the worst the car has felt. I am not happy at all.",
    "Enough of this. The car is unpredictable and I cannot push it.",
  ],
};

/**
 * A happy driver still reports the one thing that is not perfect, but frames it
 * as a minor note rather than a complaint. Without this, a delighted opener could
 * be followed by a blunt criticism and read as self-contradictory.
 */
const PRACTICE_POSITIVE_NOTE_FRAMES = [
  "The only small thing is that",
  "If I am being picky,",
  "One minor note:",
  "The last little bit is that",
  "Nothing serious, but",
  "The one detail left is that",
] as const;

const PRACTICE_NEGATIVE_NOTE_FRAMES = [
  "The main problem is that",
  "What is really hurting me is that",
  "The biggest issue:",
  "I keep running into the same thing:",
  "The part I cannot live with is that",
  "What is costing us is that",
] as const;

/**
 * Drag and spare cooling cost lap time without fighting the driver, so they
 * never earn the "the car is against me" language. These frames complain about
 * lost speed instead, which is how the annoyance actually sounds.
 */
const PRACTICE_EFFICIENCY_NOTE_FRAMES = [
  "We are just giving lap time away:",
  "The annoying part is that",
  "Where we are losing it is that",
  "It is wasted time, because",
  "What bothers me is that",
  "We are leaving speed on the table:",
] as const;

/** How the driver signs off, matched to the mood rather than to the data. */
const PRACTICE_MOOD_CLOSERS: Readonly<Record<PracticeMood, readonly string[]>> = {
  DELIGHTED: [
    "Do not touch a thing, this is the car I want.",
    "Protect this baseline; I am confident with it.",
    "Keep it exactly here and let me get more laps in.",
    "If we leave it alone, I can deliver on this.",
    "Whatever you did, keep it. I am very happy.",
    "Only tiny refinements from here, nothing bigger.",
  ],
  HAPPY: [
    "One small step and I think we are there.",
    "Let us refine it gently rather than change direction.",
    "Keep the good part and tidy the rest.",
    "I would only make a light adjustment from here.",
    "We are close, so let us not get greedy.",
    "A small trim and I will confirm it next run.",
  ],
  NEUTRAL: [
    "Give me one clear change so I can feel the difference.",
    "Let us pick a direction and commit to it.",
    "One parameter at a time; I need something to compare.",
    "I want a decisive step, not a compromise.",
    "Make it obvious from the cockpit and I will tell you straight away.",
    "Let us try something and see if I like it more.",
  ],
  FRUSTRATED: [
    "Please sort this out before the next run.",
    "I need a proper change, not a token one.",
    "Give me something I can actually trust out there.",
    "We have to fix this or the lap time will not come.",
    "Do something meaningful with it; this is costing us.",
    "I cannot keep driving around this problem.",
  ],
  ANGRY: [
    "Change it properly, I am not going out like this again.",
    "This needs a real fix, right now.",
    "I want a big step, because small ones are not working.",
    "Sort the car out or we are wasting the weekend.",
    "Do not send me back out with this balance.",
    "We need to start again with this, seriously.",
  ],
};

type SetupVoice = "FRONT" | "DRAG" | "PLATFORM" | "REAR" | "COOLING" | "COOLING_DRAG" | "BALANCED";

const SETUP_VOICES: Readonly<Record<SetupVoice, { driver: readonly string[] }>> = {
  FRONT: {
    driver: [
      "I need a second bite of steering through Copse",
      "the front washes wide when the speed stays in the car",
      "Maggotts asks for more front authority than I have",
      "the quick entries are making me wait before I can commit",
      "I am opening the steering too early to save the front tyre",
      "the car rotates in the slow stuff, then runs out of nose at speed",
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
  LOW_GRIP: [
    "there is no grip when I ask the front to turn; I am just waiting for it to bite",
    "the wet patch has taken the platform away and I am driving the car with no margin",
    "I have zero confidence on entry; the surface is moving underneath me",
    "the rear is floating on throttle and the lap is all corrections now",
    "I cannot lean on the car in this sector, the grip is simply not there",
    "every small steering input is becoming a big slide in the damp section",
  ],
  BRAKING_LOCKUP: [
    "front lock-up into the braking zone; the water is deeper than the radar showed",
    "I locked the front and lost the reference completely in the spray",
    "the braking grip disappeared on turn-in, I had to release and catch it",
    "another lock-up on the damp line; I cannot use the normal braking marker",
    "the pedal went long and the front axle just stopped responding",
  ],
  REAR_SNAP: [
    "big rear snap through the wet corner; I caught it but that was close",
    "the rear stepped out without warning and nearly put me in the wall",
    "I had a proper moment there, the water is sitting across the exit",
    "the back has gone suddenly; I need a safer line through that corner",
    "massive oversteer on throttle, there is no traction off the wet kerb",
  ],
  SPRAY_VISIBILITY: [
    "I cannot see the apex through the spray behind this car",
    "visibility is dropping every time I close the gap; I need a clear reference",
    "the spray is swallowing the braking board, I am lifting early",
    "I have no idea where the car ahead is in the wet plume",
    "the track is driveable but I cannot see enough to attack safely",
  ],
  SPIN_RECOVERY: [
    "I spun, I spun — car is okay, give me a gap to rejoin",
    "that was a full spin; I am facing the right way and recovering now",
    "I lost the rear and looped it, no contact, just tell me when it is clear",
    "I am back on line after the spin, tyres are dirty and the grip is gone",
    "that one was on me — I have recovered, but the rear is still moving",
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
  SLOW_CAR_AHEAD: [
    "the car in front is nowhere near my pace and I am stuck behind him",
    "I am losing time every lap to a car that cannot hold this speed",
    "he is slow in every corner and I still cannot find a way past",
    "this is costing me the whole stint and he is not even fighting",
  ],
  BLOCKED_ANGRY: [
    "that was a completely unnecessary block into the corner",
    "he moved under braking and I had to take avoiding action",
    "I was fully alongside and he just closed the door on me",
    "that is the second time he has done that to me today",
  ],
  STRATEGY_DOUBT: [
    "I am not convinced this plan is working for us",
    "this strategy is putting me in traffic instead of clear air",
    "I think we have called this one wrong",
    "the numbers on my dash do not match what you are telling me",
  ],
  STRATEGY_APPROVAL: [
    "this plan is working exactly as we discussed",
    "good call, the car came alive after that change",
    "I like this strategy; the tyre is holding on much better",
    "that was the right decision at the right moment",
  ],
  PIT_CALL_LATE: [
    "we left that stop far too late and it has cost us",
    "I was asking for this lap and we waited another two",
    "the tyre was finished long before we finally boxed",
    "that call needed to come earlier than it did",
  ],
  TRAFFIC_FRUSTRATION: [
    "I am spending my whole race in someone else's air",
    "every time I clear one car there is another right in front",
    "this traffic is destroying the tyre and the lap time",
    "I cannot show our real pace stuck in this queue",
  ],
  FIRST_DROPS: [
    "I felt the first drops on my visor through the last corner",
    "there is definitely something in the air now",
    "a few spots landing on the straight, nothing on the line yet",
    "the visor is picking up rain even though the track is still dry",
  ],
  CAR_HAPPY: [
    "the car feels genuinely good underneath me now",
    "this is the best balance I have had all weekend",
    "I can place it exactly where I want in every corner",
    "the platform is stable and I can lean on it properly",
  ],
  PACE_COMPLAINT: [
    "we simply do not have the pace of the cars around us",
    "I am driving at the limit and still losing time on the straights",
    "there is nothing more in this car at the moment",
    "the deficit is in the corners and I cannot drive around it",
  ],
  POSITION_LOST: [
    "I have lost that position and I could not do anything about it",
    "he got the move done and I had no answer on the straight",
    "that hurts; I was defending as hard as I could",
    "we have dropped a place and I need something to fight back with",
  ],
  POSITION_GAINED: [
    "that is the move done, I am through and clear",
    "position gained and the car still feels strong",
    "I got him into the braking zone cleanly",
    "that is one more place; let us keep this going",
  ],
  FINAL_LAPS_PUSH: [
    "these are the closing laps and I am ready to empty the car",
    "tell me what I have left because I am going for it now",
    "final push; give me everything the car has",
    "this is the run to the flag and I am committed",
  ],
  SAFETY_CAR_DEPLOYED: [
    "the Safety Car is out and the car ahead is braking hard for the queue",
    "I have caught the incident traffic; the field is compressing quickly",
    "the race has slowed suddenly and I am watching the queue ahead",
    "there is no racing line now, just the Safety Car and a wall of traffic",
    "I am in the train, tyres are cooling and the gaps are disappearing",
  ],
  SAFETY_CAR_BUNCHING: [
    "the field is stacking up and the car ahead is leaving me nowhere to go",
    "we are nose to tail now; I cannot lose this queue position",
    "the gap has collapsed and every car is fighting for the restart order",
    "the pace is painfully slow but I am keeping the tyres alive in the train",
    "the car ahead is crawling; tell me where the queue is going to settle",
  ],
  SAFETY_CAR_WAVE_BY: [
    "I have been released to pass the Safety Car and I am going now",
    "the wave-by is open; I will clear it cleanly and rejoin at the back",
    "I am catching the Safety Car, confirm the rejoin gap when I am through",
    "the lapped cars are moving; I need a clear call before the window closes",
    "I have a run on the Safety Car and I do not want to lose the wave-by",
  ],
  SAFETY_CAR_RESTART: [
    "the Safety Car is coming in and the whole train is ready to explode",
    "I can see the restart building; the car ahead is trying to control the gap",
    "the Safety Car is in the pit lane, tell me where the restart line is",
    "this is the moment; brakes, tyres and battery are all coming alive",
    "everyone is bunching for the restart and I need the gap call immediately",
  ],
  VSC_DELTA: [
    "the delta is the only thing that matters and the car ahead is still too close",
    "I am giving up the lap time, but I need a clear positive delta target",
    "the VSC pace is awkward; I am lifting before the car ahead catches me",
    "the field is frozen and I am protecting the delta through every sector",
    "I cannot race him under VSC; tell me when I can use the battery again",
  ],
  YELLOW_CONTROL: [
    "there is a car or debris in this sector and I am lifting early",
    "the yellow is real here; I have no visibility beyond the next corner",
    "I am leaving margin through the controlled sector, but the car behind is close",
    "the track is compromised in this sector and the racing line is not safe",
    "I am backing off now; tell me when the sector is clear again",
  ],
  RED_FLAG_SUSPENSION: [
    "Red Flag, understood; I am done racing and heading for the pit queue",
    "the race is suspended and I am bringing it back safely, no heroics",
    "Red Flag is out; the car is moving but this feels completely wrong at race pace",
    "I have lost the race, the rhythm and the temperature all at once — following the queue",
    "the track is not safe, copy Red Flag; I will protect the car to the pits",
  ],
  RED_FLAG_RESTART: [
    "the restart is coming and the car finally feels alive again",
    "I am ready for the restart; tell me if it is standing or rolling",
    "the tyres are coming back and I am not giving this race away",
    "everyone has had a reset, but I still remember where we were before the flag",
    "we have one chance when this goes green — give me the restart gap",
  ],
  CAR_AHEAD_CLOSING: [
    "the car ahead is coming back toward me and I can attack the next straight",
    "I am closing rapidly on the car in front under braking",
    "the gap is falling every sector; give me the battery target to finish it",
    "I have a run on him now and the front is responding properly",
    "he is vulnerable ahead, but I need the call before I commit",
  ],
  CAR_AHEAD_PULLING_AWAY: [
    "the car ahead is opening the gap and I am losing the tow",
    "he is getting away through the exits; I need to understand where we are losing it",
    "the gap has jumped and I cannot keep him in range on the straight",
    "I am pushing but the car ahead is still pulling clear",
    "we are losing contact with the group in front and I need a different plan",
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
  LOW_GRIP: ["I need the wettest sector and a safer target.", "Tell me if this patch is getting worse next lap.", "I need more margin through the damp corners.", "Check the cars ahead; I have no reference for the grip.", "If this continues, prepare the wet tyre call."],
  BRAKING_LOCKUP: ["Move my braking reference back for the wet line.", "Tell me where the standing water is before I arrive.", "I need a delta on the next braking zone.", "Check the brake balance; the front is locking again.", "Give me the safe line through this sector."],
  REAR_SNAP: ["I need a calmer differential target for this surface.", "Tell me if the exit is still flooded.", "I will take the conservative line until the grip returns.", "Check the rear temperatures and the wetness at this corner.", "Prepare for a tyre change if this keeps happening."],
  SPRAY_VISIBILITY: ["Give me the gap; I cannot see the car ahead.", "Tell me the braking board through the spray.", "I need clear air before I attack.", "Report the visibility to the cars behind.", "Keep the gap stable until the plume clears."],
  SPIN_RECOVERY: ["Give me a safe gap to rejoin.", "Tell me if the track is clear behind.", "Check the tyres and the damage after that spin.", "I need a clean lap to rebuild confidence.", "Keep the incident under review; I am back racing."],
  AQUAPLANING: ["This needs reporting to race control.", "I need a safer pace instruction immediately.", "Check the standing-water level because this is too much.", "We should not be racing at this speed.", "Tell me if the safety car is being considered."],
  DRYING_LINE: ["Check the slick crossover for me.", "I need the dry-line trend over the next lap.", "Tell me where I can cool the tyre.", "Compare my sectors with the cars already on slicks.", "Do not leave me on this tyre once it overheats."],
  INTER_CROSSOVER: ["Give me the next two-minute radar picture.", "Compare the intermediate to staying out.", "I need a clear call before the pit entry.", "Watch the sector times of anyone who has stopped.", "Tell me if this rain is building or passing."],
  SLOW_CAR_AHEAD: ["Get me past him somehow.", "Tell me where he is weakest.", "Can we use the pit window to clear him?", "I need a plan because this is wasting the stint."],
  BLOCKED_ANGRY: ["Report that to race control.", "That deserves a look from the stewards.", "Tell him to leave me room.", "I want that reviewed."],
  STRATEGY_DOUBT: ["Talk me through the thinking here.", "Show me the numbers behind this.", "Give me an alternative before it is too late.", "Convince me this is right."],
  STRATEGY_APPROVAL: ["Keep doing exactly this.", "Stay on this plan.", "Tell the crew that was well judged.", "Same again for the next stint."],
  PIT_CALL_LATE: ["Do not leave the next one that long.", "Call it earlier next time.", "Watch my degradation more closely.", "I need the stop when I ask for it."],
  TRAFFIC_FRUSTRATION: ["Find me clear air.", "Use the strategy to break me out of this.", "Tell me the gap to the front of this queue.", "I need a window, any window."],
  FIRST_DROPS: ["Watch the radar closely now.", "Tell me if this is the front of a cell.", "Keep the intermediates ready.", "Give me a warning before it arrives properly."],
  CAR_HAPPY: ["Do not change anything.", "Note this setup for the next race.", "Let me keep pushing like this.", "Tell me if I need to manage anything."],
  PACE_COMPLAINT: ["We need to look at this after the race.", "Tell me if the others are doing something different.", "Give me any mode that helps.", "I want to understand where it is going."],
  POSITION_LOST: ["Give me a plan to get it back.", "Tell me his weak sector.", "Can we get him at the stops?", "I need something different to fight him."],
  POSITION_GAINED: ["Tell me the next target.", "Give me the gap to the car ahead.", "How is the tyre after that fight?", "Keep me informed on the one behind."],
  FINAL_LAPS_PUSH: ["Tell me how much I can use.", "Give me every mode you have.", "Count me down to the flag.", "Let me know if anyone is closing."],
  SAFETY_CAR_DEPLOYED: ["How long is the pit lane closed?", "Give me the incident location and queue target.", "Tell me if the car ahead is the correct gap.", "Keep me updated on the Safety Car speed."],
  SAFETY_CAR_BUNCHING: ["Protect the tyre temperature and hold the queue.", "Tell me when the field is fully bunched.", "No risks here; I need the restart phase early.", "Keep the battery ready for the restart."],
  SAFETY_CAR_WAVE_BY: ["Copy the wave-by; I will rejoin at the back.", "Give me the rejoin target when I clear the Safety Car.", "Confirm when the wave-by window closes.", "I will complete it safely and preserve the order."],
  SAFETY_CAR_RESTART: ["Safety Car in; tyres and brakes to the window now.", "I will call the restart line and protect the gap.", "Prepare the battery for the first green lap.", "Stay with the car ahead until the restart line."],
  VSC_DELTA: ["Positive delta is the priority.", "No overtaking; I will keep the car inside the target.", "I will hold the energy for the restart call.", "Tell me immediately if VSC becomes Safety Car."],
  YELLOW_CONTROL: ["Copy, lifting in the controlled sector.", "I will leave margin until the yellow clears.", "Keep the incident location coming.", "No overtake here; I will protect the car."],
  RED_FLAG_SUSPENSION: ["Copy Red Flag. Bring it safely to the pit-lane queue.", "No overtaking, no risk; we will confirm the restart procedure.", "The race is suspended. Protect tyres, brakes and the car.", "Follow the queue and wait for the FIA restart call."],
  RED_FLAG_RESTART: ["We will confirm standing or rolling restart now.", "Build the tyres and brakes without exceeding the formation speed.", "Restart line is the reference; be ready for green.", "We have a race to finish — keep the car clean."],
  CAR_AHEAD_CLOSING: ["Tell me the battery target for the move.", "Give me the best corner to pressure him.", "I will build the run and commit if the gap opens.", "Keep the gap calls short; I am ready to attack."],
  CAR_AHEAD_PULLING_AWAY: ["Give me the sector loss to the car ahead.", "Tell me if I should protect the tyre or keep pushing.", "I need a different deployment plan to stay with him.", "Keep me informed if he starts fighting the car behind."],
};

/*
 * Short, emotional calls for the moments a driver actually reacts rather than
 * reports. Kept deliberately terse: on a real radio these arrive clipped, and a
 * measured three-clause sentence would read as narration.
 */
const RADIO_OUTBURSTS: Record<RaceRadioSituation, readonly string[]> = {
  TYRE_WEAR: ["These tyres are done.", "I've got nothing left here.", "They're gone, completely gone.", "I can't hold this pace, no grip.", "Tyres are finished, I need to box."],
  TYRE_HOT: ["They're overheating!", "I'm cooking the rears.", "Too hot, I'm losing the back.", "Everything's overheating back there.", "I need to cool these down, now."],
  TYRE_COLD: ["No temperature at all.", "These are stone cold.", "I've got zero front end.", "Nothing from the tyres yet.", "Can't switch them on."],
  ATTACK_ENERGY: ["Give me everything.", "I need the battery, now!", "Deploy, deploy!", "Let me have it on the straight.", "I'm ready, just give me the power."],
  ATTACK_TYRE: ["I'm coming for him.", "The tyres are good, let me go.", "I can take him, trust me.", "Let me push, I've got the grip.", "This is my chance."],
  DIRTY_AIR: ["I can't follow this close.", "I'm stuck in his air.", "No downforce behind him.", "Get me out of this dirty air.", "I'm losing the front here."],
  BALANCE: ["The car's not right.", "I'm fighting it every corner.", "Something's off at the rear.", "This balance is killing me.", "I can't drive around this."],
  DEFENDING: ["He's right on me!", "I'm holding him, just.", "He's got a run, help me.", "I can't defend forever.", "Keep him behind, tell me the gap."],
  STABLE: ["Feeling good.", "Happy with this.", "The car's alive, let's go.", "Nice and steady here.", "I'm in a rhythm now."],
  RAIN_STARTING: ["Rain, rain!", "I'm feeling drops.", "It's starting out here.", "First spots on the visor.", "Rain in the last corner."],
  RAIN_INTENSIFYING: ["It's getting worse!", "This is properly wet now.", "I need wets, it's coming down.", "It's much heavier out here.", "Box me, this is too much."],
  RAIN_EASING: ["It's easing off.", "Drying already.", "Rain's passing through.", "I can see a line forming.", "It's much better now."],
  LOCAL_SHOWER: ["Only wet in one part.", "Dry everywhere but there.", "It's a shower in sector two.", "One corner is soaked.", "Watch that patch for me."],
  RAIN_RUNNING: ["Happy on this tyre.", "Good in the wet.", "This feels right for the conditions.", "I've got confidence here.", "Comfortable, keep me out."],
  WET_GRIP: ["No grip at all!", "I'm on the wrong tyre.", "I can't stay on the track.", "This is undriveable.", "I need to box, please."],
  LOW_GRIP: ["There is nothing there!", "I have no grip in the wet!", "The car is skating everywhere!", "I cannot lean on this!", "I am just catching slides now!"],
  BRAKING_LOCKUP: ["Lock-up! Front locked!", "I cannot stop the car!", "The brakes went away there!", "Another lock-up, damn it!", "No braking grip in the wet!"],
  REAR_SNAP: ["Big snap!", "I nearly lost it!", "The rear just went!", "That was a huge moment!", "I caught it, but it is vicious out there!"],
  SPRAY_VISIBILITY: ["I cannot see anything!", "The spray is awful!", "Where is the braking board?!", "I have no visibility behind him!", "I cannot attack blind!"],
  SPIN_RECOVERY: ["I spun!", "That was a full spin!", "I lost it, I lost it!", "Back on track, tyres are filthy!", "My mistake — I am recovering!"],
  AQUAPLANING: ["I'm aquaplaning!", "Standing water, it's dangerous!", "I nearly lost it there.", "This isn't safe.", "We need the safety car."],
  DRYING_LINE: ["The line's drying fast.", "Slicks would work now.", "It's ready for dries.", "I'm losing time on these.", "Get me on slicks."],
  INTER_CROSSOVER: ["I need a decision.", "Tell me now, in or stay out.", "This is the moment.", "Make the call.", "I can't judge it from here."],
  SLOW_CAR_AHEAD: ["This guy is so slow!", "Come on, he's holding me up!", "I'm way faster than him!", "Get him out of my way!", "This is ridiculous, he's nowhere."],
  BLOCKED_ANGRY: ["That's dangerous!", "He can't do that!", "Oh come on!", "He pushed me off!", "Did you see that?!"],
  STRATEGY_DOUBT: ["I don't like this plan.", "Are you sure about this?", "This isn't working.", "I think we've got this wrong.", "Really? This is the call?"],
  STRATEGY_APPROVAL: ["Great call!", "Yes, that worked.", "Good job, guys.", "That was perfect.", "Love it, keep going."],
  PIT_CALL_LATE: ["That was too late!", "I asked two laps ago!", "Why did we wait?", "The tyre was dead!", "We lost time there."],
  TRAFFIC_FRUSTRATION: ["Traffic again!", "I can't get clear!", "Every single lap!", "This is hopeless in here.", "I need clean air!"],
  FIRST_DROPS: ["I felt a drop.", "Rain, on my visor.", "Something's coming.", "Spots of rain out here.", "It's starting, I think."],
  CAR_HAPPY: ["The car's beautiful.", "This feels great!", "Yes, that's it.", "I'm loving this.", "Perfect balance."],
  PACE_COMPLAINT: ["We're just too slow.", "There's nothing here.", "I can't do any more.", "They're walking away.", "This isn't enough."],
  POSITION_LOST: ["No! He got me.", "I couldn't hold him.", "Lost the place.", "Nothing I could do.", "Damn it."],
  POSITION_GAINED: ["Got him!", "Yes! That's the move.", "Through, and clear.", "One more down.", "Beautiful."],
  FINAL_LAPS_PUSH: ["Let's finish this.", "Everything now!", "I'm going for it.", "Full attack.", "All in."],
  SAFETY_CAR_DEPLOYED: ["Safety Car!", "He's slowing right up!", "The queue is here!", "No racing now, understood.", "What happened ahead?!"],
  SAFETY_CAR_BUNCHING: ["This is so slow!", "I'm right on his gearbox!", "Hold the queue, hold it!", "Everyone is crawling!", "Don't let me lose this place!"],
  SAFETY_CAR_WAVE_BY: ["Wave-by, wave-by!", "I'm going past!", "Clear the Safety Car!", "Tell me where to rejoin!", "The window is closing!"],
  SAFETY_CAR_RESTART: ["Restart now!", "Let's go, let's go!", "He's backing everyone up!", "The tyres are ready!", "Give me the line!"],
  VSC_DELTA: ["Delta, delta!", "I cannot race him!", "I'm losing so much time!", "Keep me positive!", "Is it going green?!"],
  YELLOW_CONTROL: ["Yellow here!", "I'm lifting!", "There's something on track!", "No grip through this sector!", "Tell me when it's clear!"],
  RED_FLAG_SUSPENSION: ["Red Flag?!", "This is not safe!", "Race suspended, understood!", "I'm bringing it back!", "What a mess!"],
  RED_FLAG_RESTART: ["We are racing again!", "Come on, let's finish this!", "I am ready!", "No way we give this up!", "Green soon, give me the gap!"],
  CAR_AHEAD_CLOSING: ["I'm coming for him!", "He's getting closer!", "I have a run!", "Give me the battery!", "This is the chance!"],
  CAR_AHEAD_PULLING_AWAY: ["He's getting away!", "I can't hold the gap!", "We're losing him!", "The tow is gone!", "I need help here!"],
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

/**
 * The driver's mood comes from how far the car is from its window, which is what
 * `balanceIssue` and the balance percentages already describe. A car inside the
 * window is enjoyable; a car well outside it is genuinely irritating to drive.
 */
export function practiceMoodFor(context: Pick<SessionMessageContext,
  "balanceIssue" | "aeroBalancePercent" | "mechanicalBalancePercent" | "thermalMarginPercent" | "tyreConditionPercent" | "position"
>): PracticeMood {
  const worstBalance = Math.min(
    context.aeroBalancePercent,
    context.mechanicalBalancePercent,
    context.thermalMarginPercent,
  );
  const settled = context.balanceIssue.includes("stable");
  // A strong classification lifts the mood a little; a poor one weighs on it.
  const positionBias = context.position === null ? -8 : context.position <= 3 ? 6 : context.position <= 10 ? 0 : -6;
  const score = worstBalance + (settled ? 8 : 0) + positionBias + (context.tyreConditionPercent < 55 ? -5 : 0);
  const mood: PracticeMood = score >= 92
    ? "DELIGHTED"
    : score >= 78 ? "HAPPY" : score >= 62 ? "NEUTRAL" : score >= 46 ? "FRUSTRATED" : "ANGRY";
  /*
   * Excess drag or spare cooling costs lap time but never makes the car hard to
   * drive, so it cannot produce an "undriveable" reaction however far the setup
   * sits from the optimum.
   */
  const efficiencyOnly = context.balanceIssue.includes("drag") || context.balanceIssue.includes("excess cooling");
  return efficiencyOnly && mood === "ANGRY" ? "FRUSTRATED" : mood;
}

function sentenceCase(message: string): string {
  return `${message.charAt(0).toUpperCase()}${message.slice(1)}`;
}

function qualifyingDriverReaction(context: SessionMessageContext, stream: number): string {
  const observation = sentenceCase(choice(
    SETUP_VOICES[setupVoiceFor(context.balanceIssue)].driver,
    context.seed,
    stream + 3,
    3,
  ));

  if (context.outcome === "NO RUN" || context.position === null) {
    const reaction = choice(QUALIFYING_NO_TIME_REACTIONS, context.seed, stream + 10, 10);
    return `${reaction} ${observation}.`;
  }

  if (context.outcome === "ELIMINATED") {
    const reaction = choice(QUALIFYING_ELIMINATED_REACTIONS, context.seed, stream + 11, 11);
    return `${reaction} P${context.position} and out — ${observation}.`;
  }

  if (context.outcome === "ADVANCED") {
    const reaction = choice(QUALIFYING_ADVANCED_REACTIONS, context.seed, stream + 12, 12);
    return `${reaction} P${context.position} gets us through. ${observation}.`;
  }

  const reactions = context.position <= 3 ? QUALIFYING_TOP_REACTIONS : QUALIFYING_GRID_REACTIONS;
  const reaction = choice(reactions, context.seed, stream + 13, 13);
  return `${reaction} We finish P${context.position}. ${observation}.`;
}

export function buildSessionDriverMessage(context: SessionMessageContext): string {
  const stream = context.carIndex * 29 + context.sessionIndex * 11;
  if (context.phase === "QUALIFYING") return qualifyingDriverReaction(context, stream);
  if (context.outcome === "NO RUN") {
    return `We never got a proper lap in ${context.session}. Use the other car as the reference and give me one simple question next run.`;
  }
  /*
   * Practice feedback is the driver describing the run they just completed, so
   * it leads with how the car felt rather than with a data read. The mood picks
   * the opener and the sign-off, which is what makes a good run sound different
   * from a run that fought the driver the whole way.
   */
  const mood = practiceMoodFor(context);
  const voice = SETUP_VOICES[setupVoiceFor(context.balanceIssue)];
  // Each element draws on its own stream so the opener, the note and the sign-off
  // vary independently rather than moving together.
  const opener = choice(PRACTICE_MOOD_OPENERS[mood], context.seed, stream + 211, context.carIndex + 2);
  const observation = choice(voice.driver, context.seed, stream + 307, context.sessionIndex + 3);
  const closer = choice(PRACTICE_MOOD_CLOSERS[mood], context.seed, stream + 419, context.laps + 4);
  const settled = context.balanceIssue.includes("stable");
  if (mood === "DELIGHTED" || mood === "HAPPY") {
    // A car in the window needs no caveat at all when the balance is settled.
    if (settled) return `${opener} ${sentenceCase(observation)}. ${closer}`;
    const frame = choice(PRACTICE_POSITIVE_NOTE_FRAMES, context.seed, stream + 523, context.position ?? 5);
    return `${opener} ${frame} ${observation}. ${closer}`;
  }
  if (mood === "NEUTRAL") return `${opener} ${sentenceCase(observation)}. ${closer}`;
  /*
   * A car that is merely inefficient is irritating rather than frightening, so
   * the complaint is about lost speed instead of lost confidence.
   */
  const efficiencyOnly = setupVoiceFor(context.balanceIssue) === "DRAG"
    || setupVoiceFor(context.balanceIssue) === "COOLING_DRAG";
  const frames = efficiencyOnly ? PRACTICE_EFFICIENCY_NOTE_FRAMES : PRACTICE_NEGATIVE_NOTE_FRAMES;
  const frame = choice(frames, context.seed, stream + 619, context.position ?? 5);
  return `${opener} ${frame} ${observation}. ${closer}`;
}

export function buildRaceDriverRadio(context: RaceDriverRadioContext): string {
  const stream = context.carIndex * 37 + Object.keys(RADIO_OBSERVATIONS).indexOf(context.situation) * 17;
  /*
   * An urgent situation gets the clipped, emotional call. Only the routine
   * reports build the full opener/observation/request sentence, which keeps the
   * long-form voice for moments that can actually carry it.
   */
  if (context.intensity === "HIGH") {
    return choice(RADIO_OUTBURSTS[context.situation], context.seed, stream + 21, context.tick);
  }
  const opener = choice(RADIO_OPENERS, context.seed, stream + 7, context.tick);
  const observation = choice(RADIO_OBSERVATIONS[context.situation], context.seed, stream + 8, context.tick + 1);
  const request = choice(RADIO_REQUESTS[context.situation], context.seed, stream + 9, context.tick + 2);
  return `${opener} ${observation}${context.metric ? ` — ${context.metric}.` : "."} ${request}`;
}

export const SESSION_DEBRIEF_VARIANT_CAPACITY = Math.min(
  // Qualifying keeps the opener/observation/request construction.
  Math.max(DRIVER_OPENERS.length, DRIVER_QUALIFYING_OPENERS.length)
    * Math.min(...Object.values(SETUP_VOICES).map((voice) => voice.driver.length))
    * DRIVER_REQUESTS.length,
  // Practice combines one mood's openers and closers with the balance voice.
  Math.min(...Object.values(PRACTICE_MOOD_OPENERS).map((values) => values.length))
    * Math.min(...Object.values(SETUP_VOICES).map((voice) => voice.driver.length))
    * Math.min(...Object.values(PRACTICE_MOOD_CLOSERS).map((values) => values.length)),
);
export const RACE_DRIVER_RADIO_VARIANT_CAPACITY = RADIO_OPENERS.length
  * Math.min(...Object.values(RADIO_OBSERVATIONS).map((values) => values.length))
  * Math.min(...Object.values(RADIO_REQUESTS).map((values) => values.length));
