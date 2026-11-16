/**
 * What each poster panel shows, for people who can't see the art: its alt text
 * on the episode's page (poster-panels.ts). The sources have no such text, so
 * these were written by looking at each lettered panel, and checked again against
 * the universal A2 set's art on 2026-11-11. The owner approves them with the
 * change that puts them online.
 */

interface BookDescription {
  ep: number;
  panel: number;
  alt: string;
}

const BOOK_DESCRIPTIONS: readonly BookDescription[] = [
  {
    ep: 1,
    panel: 1,
    alt: "In an office, Amr looks doubtful and gestures at a board where the tap, report and poster cards are all tagged first. The Dinosaur scratches its head, and a tap overflows a bucket near the Ahwa Cup, a worried tea glass with a face.",
  },
  {
    ep: 1,
    panel: 2,
    alt: "Amr holds up one finger and looks up at the Dinosaur, who grins and points at the tap card on the board. Behind Amr, the tap still pours into the overflowing bucket, and the tea glass smiles up at them.",
  },
  {
    ep: 1,
    panel: 3,
    alt: "The board now has first and later columns, with the tap under first and the report and poster under later. Amr gestures at it as the Dinosaur walks past with a toolbox and two first tags; the tea glass stands on a crate.",
  },
  {
    ep: 1,
    panel: 4,
    alt: "The Dinosaur sits in one white sock, draining water from a shoe into a bucket, beside the cheerful tea glass. Smiling, Amr holds a sheet of paper; the tap is off and the board has the report first, the poster later.",
  },
  {
    ep: 2,
    panel: 1,
    alt: "In a bright corridor, the Scope Creep Cat raises one finger and smiles up at the Capacity Camel. The camel smiles down, with a blank wooden sign, an arrow, a paint tin and a brush strapped to its back.",
  },
  {
    ep: 2,
    panel: 2,
    alt: "The Capacity Camel stands anxiously in a doorway, its load wider than the frame: boards, a lit arrow, stars, string lights, confetti and a speaker piled high. The Scope Creep Cat looks up, one paw on its chin.",
  },
  {
    ep: 2,
    panel: 3,
    alt: "The Capacity Camel, carrying only the plain sign, arrow and paint, looks down at the smiling Scope Creep Cat. The cat grips a trolley holding a speaker, a box labelled lights and a box of confetti.",
  },
  {
    ep: 2,
    panel: 4,
    alt: "The Capacity Camel, in only a harness, and the Scope Creep Cat smile beside a welcome sign and an arrow to an open door. The visitor, Agile Sticky, a yellow sticky note with a face and briefcase, walks by; behind is a trolley tagged later.",
  },
  {
    ep: 3,
    panel: 1,
    alt: "Under a book swap sign for 12:00 and a clock at 11:50, the Deadline Rabbit, in a headband and backpack, happily pushes an empty trolley. Dependable Beaver, holding a clipboard, gestures at stacks of coloured books on a table.",
  },
  {
    ep: 3,
    panel: 2,
    alt: "A wheel pops off the loaded trolley and a blue book slides off as it tips. The Perfectionist Owl grips the handle, eyes wide, while the Deadline Rabbit recoils in a doorway, mouth open; the clock reads 11:50.",
  },
  {
    ep: 3,
    panel: 3,
    alt: "The beaver kneels by the trolley, tipped up on its side against a wooden block, and tightens a wheel with a spanner. The Deadline Rabbit kneels nearby, looking down apologetically, and the books sit in four stacks on the floor.",
  },
  {
    ep: 3,
    panel: 4,
    alt: "The Deadline Rabbit smiles, pushing the trolley with four stacks of books on board and all four wheels turning. The beaver stands beside it, grinning, and gives a thumbs up in an office lined with bookshelves.",
  },
  {
    ep: 4,
    panel: 1,
    alt: "In a meeting room, Rubber Duck Analyst sits at a table, pointing to a wall chart listing plan message, agree words and review. Meeting Monkey sits at a laptop, hand to chin, mouth open; the Ahwa Cup, a smiling tea glass with a face, stands between them.",
  },
  {
    ep: 4,
    panel: 2,
    alt: "The duck raises a hand and looks at the monkey, who smiles behind a laptop with one hand at the chin and a thumb up. The smiling tea glass stands between them, and the wall chart still lists all three steps.",
  },
  {
    ep: 4,
    panel: 3,
    alt: "The duck points across the table towards the monkey, who smiles and types on the laptop. On the wall chart, the word review is now crossed out, and the steaming tea glass smiles between them.",
  },
  {
    ep: 4,
    panel: 4,
    alt: "The monkey and the duck lean in, smiling at a laptop showing a sent message, team photo, tomorrow 2 pm in the garden, with a reply saying got it. The tea glass beams nearby; review is crossed out on the chart.",
  },
  {
    ep: 5,
    panel: 1,
    alt: "Amr, holding books under one arm, frowns with a hand to the chin at two open boxes of books and a long sealed box on the floor. Captain Blocker Ox, also frowning, stands by a desk with one hand held out towards them.",
  },
  {
    ep: 5,
    panel: 2,
    alt: "At a desk, Captain Blocker Ox smiles, holding a phone to one ear and a pen to the blank pages of an open notebook. Stacked books and a laptop sit either side of the notebook.",
  },
  {
    ep: 5,
    panel: 3,
    alt: "Amr and Captain Blocker Ox sit side by side at a desk, smiling at each other. Amr writes in a notepad, the ox gives a thumbs up, and a desk sign in front of them says building manager, check wall.",
  },
  {
    ep: 5,
    panel: 4,
    alt: "Amr smiles, one hand on a hip, and gestures up at a wall-mounted shelf filled with books. Captain Blocker Ox stands beside a desk, smiling, and the floor between them is clear of boxes.",
  },
  {
    ep: 6,
    panel: 1,
    alt: "Value Falcon, in a navy suit, folds a paper fan beside Amr, who smiles up while writing on blank name cards at a table. Capacity Camel stands behind them, carrying bags stuffed with papers.",
  },
  {
    ep: 6,
    panel: 2,
    alt: "Rubber Duck Analyst, in round glasses and carrying a briefcase, walks in waving. At the table the falcon looks round from folding a fan, Amr writes name cards and the camel stands behind with full bags.",
  },
  {
    ep: 6,
    panel: 3,
    alt: "Amr stands smiling with one hand in his pocket as the seated falcon folds a blue fan and looks up at the camel, who carries full bags. The duck stands by the table with a briefcase; a welcome banner hangs behind.",
  },
  {
    ep: 6,
    panel: 4,
    alt: "Smiling, Amr holds out a coiled charger to the duck, who sits at a laptop and reaches for it. Amr's other hand is in a drawer of chargers. The falcon reads papers and the camel stands in the background.",
  },
  {
    ep: 7,
    panel: 1,
    alt: "In an office, Meeting Monkey, smiling, holds up a sheet reading Fix printer. Dependable Beaver stands behind a desk with a red-handled toolbox on it, one thumb pointing to the side.",
  },
  {
    ep: 7,
    panel: 2,
    alt: "Captain Blocker Ox, in glasses and a white shirt, looks down with a small smile and writes on a clipboard reading Owner Ox. The monkey, hands held up at the chest, beams up at the ox, with a printer behind them.",
  },
  {
    ep: 7,
    panel: 3,
    alt: "The ox walks through the office holding the Owner Ox clipboard and gesturing towards the beaver, who smiles, gives a thumbs up and carries the toolbox. The monkey follows behind, smiling.",
  },
  {
    ep: 7,
    panel: 4,
    alt: "The ox grins and holds up a large printed poster of a tree under the word Picnic. The monkey beams with raised fists and the beaver gives a thumbs up beside a desk printer, with the toolbox and clipboard close by.",
  },
  {
    ep: 8,
    panel: 1,
    alt: "In a corridor, Silo Hedgehog, in shirt and tie, and Dependency Spider, in glasses, each carry a box out of opposite rooms onto stacks on the floor. An open storage room lies at the far end.",
  },
  {
    ep: 8,
    panel: 2,
    alt: "The hedgehog and the spider smile from behind a wall of boxes stacked across the corridor between their two doorways. Rubber Duck Analyst stands in front of the boxes with wings spread, looking up, beak open and brows raised.",
  },
  {
    ep: 8,
    panel: 3,
    alt: "The hedgehog and the spider smile as they carry boxes down the corridor and through a door marked Storage, its shelves full of boxes. Behind them, the duck peers over a few remaining boxes and smiles.",
  },
  {
    ep: 8,
    panel: 4,
    alt: "The duck, smiling with wings out, walks down a clear, shining corridor with no boxes on the floor. The hedgehog and the spider stand in the doorways on either side, both smiling, with arms spread wide.",
  },
  {
    ep: 9,
    panel: 1,
    alt: "In a break area, Feature Factory Hamster, smiling, spreads both arms beside a water dispenser with rows of identical tiny buttons. Rubber Duck Analyst holds an empty glass and looks up, puzzled, a wing to the chin.",
  },
  {
    ep: 9,
    panel: 2,
    alt: "The hamster looks down, concerned, at a clipboard showing the number 47 in front of the dispenser. Amr stands nearby with a hand to his chin and a slight smile; the duck, holding the empty glass, looks startled.",
  },
  {
    ep: 9,
    panel: 3,
    alt: "The smiling hamster and the duck each point at a different button on the dispenser's crowded panel. Amr crouches beside them, hand on chin, smiling up; the duck still holds the empty glass.",
  },
  {
    ep: 9,
    panel: 4,
    alt: "The dispenser has one large button marked Water. The delighted duck presses it and water pours into the glass, while the hamster and a crouching Amr clasp their hands and smile.",
  },
  {
    ep: 10,
    panel: 1,
    alt: "Vanity Metrics Peacock, tail fanned and in a purple jacket, gestures at a screen showing cones served rising 40, 50, 60. Feature Factory Hamster serves ice cream at counter 1, counter 2 has nobody behind it and Retrospective Turtle watches.",
  },
  {
    ep: 10,
    panel: 2,
    alt: "Six colleagues queue at counter 1, where the hamster holds a cone: Scope Creep Cat, Firefighter Fox, Perfectionist Owl, Experiment Mouse, the turtle and Rubber Duck Analyst. Counter 2, stocked with cones, has nobody behind it.",
  },
  {
    ep: 10,
    panel: 3,
    alt: "Amr, smiling, points at a screen reading People waiting 6, with a strip below it reading 6 waiting: open 2. The peacock, tail fanned, stands beside the screen and spreads one arm towards counter 2.",
  },
  {
    ep: 10,
    panel: 4,
    alt: "The peacock holds out a cone at counter 2, marked Open, and the hamster serves at counter 1. Amr stands between them, smiling under a screen reading Served 66, Waiting 0, and the duck walks away smiling with a cone.",
  },
  {
    ep: 11,
    panel: 1,
    alt: 'In a bright office, HiPPO, the hippo in a navy suit, smiles and holds up a white T-shirt with a "one size fits all" tag. Experiment Mouse, in a lab coat and goggles, looks up at it with a finger on its chin.',
  },
  {
    ep: 11,
    panel: 2,
    alt: "The mouse stands swamped in the T-shirt, its hem pooled on the floor and no hands showing as it lifts one arm. The hippo, one hand in a pocket, smiles and gestures towards it.",
  },
  {
    ep: 11,
    panel: 3,
    alt: "The hippo smiles, holding a pen over a sheet of paper. Amr, the man with short black hair, green shirt and a lanyard, stands beside the hippo, hands in pockets, smiling. A T-shirt lies on the desk.",
  },
  {
    ep: 11,
    panel: 4,
    alt: "Under a welcome banner, the hippo and the mouse wear T-shirts that fit. The hippo gives a thumbs up, the mouse throws both arms wide with its hands showing, and Amr gestures towards them with a wry smile.",
  },
  {
    ep: 12,
    panel: 1,
    alt: 'In a library, Experiment Mouse, surprised, in a lab coat and goggles, gestures at a "closed" sign on the desk. Behind it sit Requirement Chameleon, thoughtful, and Customer Voice Parrot with a notepad. A plate reads 9 am to 3 pm.',
  },
  {
    ep: 12,
    panel: 2,
    alt: "At the library desk, the mouse looks up and gestures. The chameleon frowns slightly, hand on chin, and the parrot, notepad in one wing, raises the other wing behind its head with an uneasy look.",
  },
  {
    ep: 12,
    panel: 3,
    alt: "The mouse smiles and points away from the desk, its other hand on its chest. The chameleon looks on, hand on chin, and the parrot, looking troubled, holds its pencil and notepad.",
  },
  {
    ep: 12,
    panel: 4,
    alt: 'The chameleon, smiling, sets an "open" sign on the desk, and the plate now reads 9 am to 5 pm. The mouse beams with eyes closed and hands clasped, and the parrot smiles with pencil and notepad ready.',
  },
  {
    ep: 13,
    panel: 1,
    alt: 'Amr, at his desk, smiles down at a plain white card in one hand. In his other hand is a clipboard titled "Printing check" with three ticked boxes. A card printer sits beside him.',
  },
  {
    ep: 13,
    panel: 2,
    alt: 'Deadline Rabbit, in a red "Deadline" headband, backpack and shorts, holds a card to a reader beside a glass door marked "Workroom". The reader buzzes and shows a red cross, and the rabbit looks worried.',
  },
  {
    ep: 13,
    panel: 3,
    alt: "Dependable Beaver sits at a desk in a white shirt and green tie, smiling and pointing at a monitor. The screen says the rabbit's workroom access is approved but the card is not active.",
  },
  {
    ep: 13,
    panel: 4,
    alt: "The rabbit walks through the open workroom door, card in hand, looking back with a big smile. The reader beside the door shows a green tick. Amr, seen from behind, watches.",
  },
  {
    ep: 14,
    panel: 1,
    alt: "On Monday in the office kitchen, Amr frowns as he runs the tap, mug in hand. Technical Debt Termite, in a yellow hard hat and tool belt, points in alarm at a cracked pipe under the sink, dripping into a puddle.",
  },
  {
    ep: 14,
    panel: 2,
    alt: 'Tuesday morning. Amr smiles, carrying a box holding a new white pipe. Technical Debt Termite sits at a table happily colouring a flowery "Welcome" poster with a green marker. Behind, the cracked pipe drips into a bucket.',
  },
  {
    ep: 14,
    panel: 3,
    alt: "Technical Debt Termite, chin on hand, looks worried beside the flowery poster and the boxed pipe. Amr crouches nearby, smiling at it. Under the sink, the cracked pipe still drips into a bucket of water.",
  },
  {
    ep: 14,
    panel: 4,
    alt: "Amr smiles as he runs the tap, and Technical Debt Termite happily points under the sink at a new white pipe with an empty bucket below. The old, rusted, broken pipe lies on newspaper on the floor by an empty box.",
  },
  {
    ep: 15,
    panel: 1,
    alt: 'At a round meeting table, Experiment Mouse smiles and gestures to Perfectionist Owl beside it. The owl, in round black glasses and a red bow tie, holds up a paper form headed "Draft room booking" with boxes for name, day and start.',
  },
  {
    ep: 15,
    panel: 2,
    alt: 'Deadline Rabbit, in a red "Deadline" headband, holds the draft form and a pen and looks puzzled, one hand at its chin. The mouse smiles beside a laptop, and the owl watches, one wing to its beak.',
  },
  {
    ep: 15,
    panel: 3,
    alt: "The owl, beak open, gestures with one wing. The rabbit smiles and gestures back, pen in hand, with the form standing between them showing only name, day and start. The mouse watches from behind, hands clasped.",
  },
  {
    ep: 15,
    panel: 4,
    alt: "The rabbit smiles and writes on the form, now filled in: Rabbit, tomorrow, 10 am to 12 pm, with a new end row. The owl, wings together, and the mouse, hands clasped, both look on smiling.",
  },
  {
    ep: 16,
    panel: 1,
    alt: "Deadline Rabbit, in a red headband, points up at a clock nearing noon beside a Welcome Talk 12:00 sign, one hand on a laptop showing music. Dependable Beaver holds a microphone, smiling, in a hall of empty chairs.",
  },
  {
    ep: 16,
    panel: 2,
    alt: "Amr, the man in the green shirt with a lanyard, smiles with one hand held open towards the others, the other at his side. Deadline Rabbit closes the laptop on the table while Dependable Beaver holds the microphone.",
  },
  {
    ep: 16,
    panel: 3,
    alt: "Dependable Beaver, smiling, holds up a battery in one hand and the microphone in the other, with an empty battery packet on the table. Deadline Rabbit leans on the table by the laptop, hand to chin, looking worried.",
  },
  {
    ep: 16,
    panel: 4,
    alt: "Dependable Beaver stands on the stage, beaming, speaking into the microphone with one arm out. Deadline Rabbit sits among the rows of chairs, looking up at the stage with a delighted expression.",
  },
  {
    ep: 17,
    panel: 1,
    alt: "Firefighter Fox bends to lift a notebook off a chair. Retrospective Turtle stands by a blank screen with a folder. Requirement Chameleon and Scope Creep Cat, grey and striped, sit waiting, and the Ahwa Cup, a tea glass with a face, stands on a cabinet.",
  },
  {
    ep: 17,
    panel: 2,
    alt: "Firefighter Fox, smiling, holds up a remote control, the notebook left on a seat. Retrospective Turtle clasps both hands and the tea glass cheers from a side table. The chameleon and the cat stay seated.",
  },
  {
    ep: 17,
    panel: 3,
    alt: "Firefighter Fox, hand on head and looking embarrassed, hugs a notebook and looks down at a remote lying on a chair. Retrospective Turtle smiles and points at it, while the tea glass laughs, fists raised.",
  },
  {
    ep: 17,
    panel: 4,
    alt: "Next month, Firefighter Fox, smiling, lifts the remote from a box labelled Remote here on the cabinet, beside the cheering tea glass. Retrospective Turtle gives a thumbs-up, and the chameleon and the grey cat sit waiting.",
  },
  {
    ep: 18,
    panel: 1,
    alt: "At an Open Day stand, Rubber Duck Analyst points at a tray of cards beside a 20 visitors sign, while Blame Game Wolf leans in with a magnifying glass, brows lowered. Visitors wait behind, some holding cards.",
  },
  {
    ep: 18,
    panel: 2,
    alt: "Blame Game Wolf, hand behind the head and looking worried, points at a sheet reading Today: 10 cards. Retrospective Turtle points at another reading Sign-ups: 20, and Rubber Duck Analyst looks on between them.",
  },
  {
    ep: 18,
    panel: 3,
    alt: "Blame Game Wolf, now smiling, holds open a blue folder and points at a blank form with spaces for sign-ups and cards. Retrospective Turtle holds up a card marked 20, and Rubber Duck Analyst sits between them.",
  },
  {
    ep: 18,
    panel: 4,
    alt: "Blame Game Wolf, hand to head and wide-eyed, holds a clipboard showing 24 sign-ups and 20 cards packed. Rubber Duck Analyst looks up from behind a desk, and Retrospective Turtle reads a sheet by the shelves.",
  },
  {
    ep: 19,
    panel: 1,
    alt: "Firefighter Fox, sweating, clutches a bag and holds out a phone showing a bus at 5:00 pm. Meeting Monkey raises one finger and Retrospective Turtle sits smiling between them, at a round table overlooking a city at sunset.",
  },
  {
    ep: 19,
    panel: 2,
    alt: "The fox sits at the table, head resting on one hand, eyes droopy, holding a mug with a bag alongside. The turtle smiles and points at a clipboard reading Finish meetings on time, still open.",
  },
  {
    ep: 19,
    panel: 3,
    alt: "The fox rises from the chair with a bag on one shoulder, looking surprised. The turtle, still seated, smiles and holds an open hand towards the fox, and a phone on the table shows 4:50 pm.",
  },
  {
    ep: 19,
    panel: 4,
    alt: "On a bus at sunset, the fox and the monkey sit side by side smiling, the fox taking a crisp from the bag the monkey holds. Through the window are a tower, pyramids, palm trees and a river.",
  },
  {
    ep: 20,
    panel: 1,
    alt: "Data Ghost, in glasses and a blue lanyard, frowns while pressing the button on a coffee machine in an office kitchen. Clear, steaming water runs into a white mug.",
  },
  {
    ep: 20,
    panel: 2,
    alt: "Rubber Duck Analyst, standing on a small stool on a desk, gestures at a monitor reading Repair requests, source web form, 0 open. Blame Game Wolf leans in on the other side, hand on chin, frowning.",
  },
  {
    ep: 20,
    panel: 3,
    alt: "Blame Game Wolf, seated at a desk holding a phone and smiling, brows raised, faces a monitor showing the coffee machine repair accepted, source email. Rubber Duck Analyst and Data Ghost, holding a mug, smile nearby.",
  },
  {
    ep: 20,
    panel: 4,
    alt: "Data Ghost, smiling, presses the button on the coffee machine as dark, steaming coffee pours into a white mug. Rubber Duck Analyst stands on the counter with a clipboard, looking up.",
  },
  {
    ep: 21,
    panel: 1,
    alt: "Zombie Backlog sits at a desk piled with paper, hand cupped to one ear, frowning at a phone. On the video call a smiling girl with curly hair waves both hands. Colleagues chat behind and a printer runs nearby.",
  },
  {
    ep: 21,
    panel: 2,
    alt: "Value Falcon, frowning, stands by a glass door holding up a stained, yellowed sign reading Quiet call room, 2023, deferred. Vanity Metrics Peacock, hand on chin and tail fanned, looks at it sideways.",
  },
  {
    ep: 21,
    panel: 3,
    alt: "At a glass door signed Private studio, Vanity Metrics Peacock carries in a gilt-framed portrait of the peacock. Value Falcon, holding a ring light on a tripod, gestures at it. Zombie Backlog looks on with a mug.",
  },
  {
    ep: 21,
    panel: 4,
    alt: "Zombie Backlog sits at a table behind glass, chin on one hand, smiling at a phone. On screen the girl wears a white crown and raises both arms, beaming. The open-plan office is visible through the door behind.",
  },
  {
    ep: 22,
    panel: 1,
    alt: "In a lobby decorated with balloons and a Family Day banner, Requirement Chameleon smiles and holds up a sign saying a visitor pass is required. Amr, smiling, gestures towards it with one hand on his hip.",
  },
  {
    ep: 22,
    panel: 2,
    alt: "In the same lobby, the chameleon holds a stack of paper visitor passes and gestures to Customer Voice Parrot and a grey-haired man in glasses holding a small keypad phone. Amr, frowning, spreads both hands.",
  },
  {
    ep: 22,
    panel: 3,
    alt: "At the reception desk, the parrot gestures to the grey-haired man holding up his keypad phone. The chameleon works on a tablet beside Agile Sticky, a small sticky note with a face, while Amr, hand on chest, grimaces.",
  },
  {
    ep: 22,
    panel: 4,
    alt: "At the desk, the chameleon smiles and ticks names on a clipboard. Amr, also smiling, takes a printed pass from a small printer, his other hand on an open book marked Every guest gets in.",
  },
  {
    ep: 23,
    panel: 1,
    alt: "In an office, Dependency Spider, in glasses, suit and tie, sits at a desk between tall stacks of paper, looking up worried. The Dinosaur, in shirt and tie, stands beside the desk, grinning with one arm flung out.",
  },
  {
    ep: 23,
    panel: 2,
    alt: "The spider, holding a sheet, looks distressed behind much taller paper stacks. The Dinosaur spreads both hands, frowning. Amr and Silo Hedgehog wait with papers, and a curly-haired woman sits behind them, arms crossed.",
  },
  {
    ep: 23,
    panel: 3,
    alt: "Amr, smiling and holding a folder, gestures to a board that pairs names with work: Amr with deliveries, hedgehog with returns, spider with tricky cases. The spider looks up at it, beaming.",
  },
  {
    ep: 23,
    panel: 4,
    alt: "At three desks in a row, Amr types next to a ticked address form, the hedgehog smiles on the phone beside a returns box, and the spider calmly reads a book titled Tricky Cases.",
  },
  {
    ep: 24,
    panel: 1,
    alt: "At a cluttered office table, Experiment Mouse, in goggles and lab coat, holds up a stopwatch. Overengineering Octopus, in glasses and braces, sits behind a laptop and paper stack, holding three event tickets. The Dinosaur smiles, watching.",
  },
  {
    ep: 24,
    panel: 2,
    alt: "Outside a training room, the mouse points up at a flip chart of afternoon demos: slide effects, templates, animation and export tools. The octopus, holding an open notebook, and the Dinosaur study it, hands to chins.",
  },
  {
    ep: 24,
    panel: 3,
    alt: "In a lobby, the octopus looks worried, holding a ticket marked full day, no refunds. The Dinosaur, smiling, turns both palms up. The mouse, clutching a dark folder, looks up at them with a small frown.",
  },
  {
    ep: 24,
    panel: 4,
    alt: "The Dinosaur holds a glass door open as the three walk out into the sunshine, smiling, leaving rows of empty seats behind. The octopus and the mouse carry bags and notebooks.",
  },
  {
    ep: 25,
    panel: 1,
    alt: "In a bright room, Deadline Rabbit, wearing a red Deadline headband and a backpack, dives into four open boxes of chair parts, grabbing metal legs. Retrospective Turtle, in round glasses, calmly studies the assembly instructions.",
  },
  {
    ep: 25,
    panel: 2,
    alt: "Four chair frames stand in a row, each with a backrest but no seat, and the four seats lie still wrapped on the floor. The rabbit spreads both arms, beaming, while the turtle looks on, hand to chin, worried.",
  },
  {
    ep: 25,
    panel: 3,
    alt: "The rabbit kneels, screwing a seat onto one chair with a red screwdriver, while the turtle holds the seat in place, both smiling. Three seatless frames stand behind them.",
  },
  {
    ep: 25,
    panel: 4,
    alt: "A woman with a dark bob sits on the finished chair, smiling at the rabbit, who stands with a paw on the chair back. The turtle kneels, using a screwdriver on a second chair; two more frames and two seats wait.",
  },
  {
    ep: 26,
    panel: 1,
    alt: "Experiment Mouse, in goggles and lab coat, holds open an empty printer paper tray and looks up. The Dinosaur strides past smiling, a mug in one hand, pointing at the printer with the other.",
  },
  {
    ep: 26,
    panel: 2,
    alt: "Capacity Camel, laden with files, leans towards Amr, who is thinking, hand to chin. Rubber Duck Analyst looks anxious. The mouse, sweating, strains under a wobbling tower of paper reams, and the Ahwa Cup, a small tea glass with a face, looks alarmed.",
  },
  {
    ep: 26,
    panel: 3,
    alt: "The Dinosaur, smiling, crouches by the open printer tray with four reams of paper in hand. Amr, the camel and the duck look on happily, and the mouse, empty-handed, smiles up at the Dinosaur.",
  },
  {
    ep: 26,
    panel: 4,
    alt: "In a sunny lounge, the Dinosaur stands with open hands facing a blue sofa, where the duck, the camel, the mouse and Amr sit smiling, each with a hand raised. A small tea glass character waves from the sofa arm.",
  },
];

const BY_PANEL = new Map(BOOK_DESCRIPTIONS.map((d) => [`${d.ep}:${d.panel}`, d.alt]));

/** The draft for a panel, or "" so it simply waits in the review queue. */
export function bookDescriptionFor(ep: number, panel: number): string {
  return BY_PANEL.get(`${ep}:${panel}`) ?? "";
}
