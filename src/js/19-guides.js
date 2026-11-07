
/* Read-only editorial movement guides. Original catalogue records stay unchanged.
   A movement-family guide never replaces exercise-specific or coach-written cues. */
(function(){'use strict';
const guides={};
function add(id,match,description,steps,checks){guides[id]={id,match,description,steps,checks};}
add('shoulder-press',/shoulder press|overhead press|z.press|arnold press/i,
'An overhead pressing movement for the shoulders, supported by the triceps. The seated, standing and machine versions use different levels of external support.',
['Set the seat, back support or standing stance for the named variation. Begin with the load at shoulder height and wrists supported over the forearms.','Press upward through a comfortable range while keeping your trunk steady. Let your shoulder blades move with the arms.','Lower to the starting position under control. Use the grip and movement path specified for your variation.'],
['Avoid leaning back to turn the movement into an incline press.','Do not force an overhead range that causes discomfort.']);
add('front-raise',/front raise/i,
'A shoulder isolation movement that raises the arms in front of the body. The anterior deltoids move the load while the trunk stays steady.',
['Begin with the named implement in front of your thighs. Stand or sit with a stable trunk and a small, consistent bend in the elbows.','Lift the arms forward to the height prescribed in your plan, without throwing the load upward.','Lower slowly along the same path. For a one-arm variation, keep both shoulders facing forward.'],
['Avoid rocking the body to start each repetition.','Keep the wrist aligned with the forearm.']);
add('lateral-raise',/lateral raise|side lateral/i,
'A shoulder isolation movement that lifts the upper arms away from the sides of the body. Cable, dumbbell and machine versions change the direction of resistance.',
['Set the cable, machine pads or dumbbells for your variation. Keep a small bend in the elbows.','Raise the arms outward through the planned range, keeping the neck relaxed and the trunk still.','Lower with control rather than letting the resistance drop.'],
['Avoid swinging the torso or shrugging to move a heavier load.','Keep the elbow angle consistent through the repetition.']);
add('rear-delt',/rear delt|reverse (?:pec deck|fly)|reverse.*fly/i,
'A pulling or opening movement that emphasizes the back of the shoulders. Your chest or trunk provides a stable base as the arms travel outward or backward.',
['Use the bench, machine or hinged position specified in the exercise name. Set the handles and a comfortable elbow angle.','Move the upper arms outward or backward while keeping your torso in position.','Return slowly without allowing the load to pull the shoulders abruptly forward.'],
['Avoid lifting the chest or extending the lower back to finish the movement.','Use a range you can control without jerking.']);
add('face-pull',/face pull/i,
'A cable pulling movement for the upper back and rear shoulders, combining an upper-arm pull with controlled shoulder rotation.',
['Set the rope attachment around upper-chest or face height and take a stable stance.','Draw the rope toward your face, separating the hands as the elbows move back.','Return the handles gradually while maintaining your stance.'],
['Avoid leaning backward with every repetition.','Choose resistance that allows the hands to separate without wrist strain.']);
add('chest-press',/bench press|chest press|hex press|seated cable press/i,
'A pressing movement for the chest and triceps. Bench angle, grip and equipment determine the exact path and emphasis of the variation.',
['Set the bench or seat for the named variation. Keep your feet and upper back supported and take an even grip.','Control the lowering phase to the planned depth with wrists aligned over the forearms.','Press back along the same path. Use a spotter or correctly positioned safety stops when required for a loaded bar.'],
['Avoid bouncing the load or letting the shoulders roll forward at the bottom.','A close grip changes elbow position; follow your assigned variation.']);
add('chest-fly',/pec deck|crossover|fly/i,
'An arc-shaped arm movement that brings the upper arms toward the front of the chest. Unlike a press, the elbow bend stays nearly constant.',
['Set the bench, pulleys or machine to match the named variation. Start with a comfortable bend in the elbows.','Bring the arms together in a controlled arc through the range assigned by your coach.','Reopen the arms slowly, stopping before the shoulders are pulled into an uncomfortable stretch.'],
['Avoid turning the fly into a press by repeatedly bending and straightening the elbows.','Do not chase a deeper stretch at the expense of shoulder comfort.']);
add('push-up',/push.?up/i,
'A bodyweight press in which the chest, shoulders and triceps move the body while the trunk maintains a steady line. Hand or foot elevation changes the leverage.',
['Place your hands securely and set your feet or knees for the named version. Keep your head, trunk and hips aligned.','Bend the elbows to lower your chest between the hands through the planned range.','Press the surface away and return to the starting position without letting your hips sag.'],
['Avoid reaching forward with the head while the chest stays high.','Use the prescribed hand width and support height.']);
add('dip',/\bdips?\b/i,
'A vertical bodyweight or assisted press that trains the triceps and chest. Bench, parallel-bar and machine variations have different shoulder positions.',
['Establish a secure support position on the specified bars, bench or machine. Set any assistance before starting.','Bend the elbows and lower only through a controlled, comfortable shoulder range.','Press back to the supported starting position without swinging.'],
['Avoid dropping rapidly into a deep bottom position.','Use assistance when you cannot control your bodyweight.']);
add('leg-press',/leg press(?!.*calf)/i,
'A supported lower-body press for the thighs and glutes. The seat and platform determine the movement path, while foot placement changes the available range.',
['Set the seat and safety catches. Place the working foot or feet securely on the platform.','Lower the sled or seat while keeping the pelvis supported and knees tracking with the feet.','Press away under control, then return without slamming the stack or forcefully snapping the knees straight.'],
['Avoid lowering so far that the pelvis rolls away from the pad.','For single-leg work, keep the pelvis level against the support.']);
add('split-squat',/split squat|lunges?|sissy squat/i,
'A knee-dominant lower-body movement that challenges leg strength and balance. The stance, direction of travel and rear-foot support distinguish each variation.',
['Set the stance and support described in the exercise name. For a Bulgarian split squat, place the rear foot on a secure support.','Bend the working knee and hip through a controlled range, keeping balance over the supporting foot.','Drive through the working foot to return. For walking lunges, finish the repetition before stepping into the next one.'],
['Avoid losing foot contact or allowing the knee to collapse inward.','A sissy squat uses a different, knee-dominant setup; use the coach-assigned support and range.']);
add('squat',/squat/i,
'A coordinated hip-and-knee movement for the thighs and glutes. The load position or machine support changes the balance demands of the squat.',
['Set the rack or machine safety stops and position the load for the named squat. Establish a balanced stance.','Bend the knees and hips together, keeping the feet grounded and knees tracking with the toes.','Return to standing through the range you can control without losing your trunk position.'],
['Avoid dropping into the bottom or bouncing off the stops.','Keep the load supported securely; front and back rack positions are different.']);
add('step-up',/step.?up/i,
'A single-leg stepping movement for the thighs and glutes. A stable platform makes it possible to train the working leg through a deliberate upward step.',
['Use a secure platform at your assigned height. Place the whole working foot on it.','Press through that foot to step up, keeping the knee aligned and the pelvis controlled.','Step down slowly and reset before the next repetition.'],
['Avoid jumping off the trailing foot to do most of the work.','Do not use a platform height that forces the pelvis to twist.']);
add('leg-extension',/leg extensions?|knee extension/i,
'A supported knee-extension movement that isolates the quadriceps at the front of the thigh.',
['Adjust the seat and pad so the knee aligns with the machine pivot and the pad rests above the ankle.','Straighten the knee through the prescribed range while keeping your hips on the seat.','Lower the resistance slowly to the start position.'],
['Avoid kicking the pad with momentum.','Keep the machine adjusted to your leg length.']);
add('leg-curl',/hamstring curl|leg curl/i,
'A knee-flexion movement for the hamstrings. Seated and lying machines support the body differently while the lower leg moves against resistance.',
['Align your knees with the machine pivot and secure the pads for the seated or lying variation.','Bend the knees against the resistance without lifting the hips from the support.','Return gradually while maintaining control of the pad.'],
['Avoid arching the lower back to move the load.','Keep the pad secure rather than letting it slide along the lower leg.']);
add('hinge',/\brdl\b|romanian|stiff.leg|good morning|deadlift|rack pull/i,
'A hip-hinge pattern that loads the posterior chain. Deadlifts begin from the specified floor or rack height; Romanian deadlifts and good mornings use a controlled lowering phase.',
['Use the stance, grip and starting height for the named variation. Set the load close to your body and brace your trunk.','Move through the hips while keeping the load controlled. In a Romanian deadlift or good morning, send the hips back as the torso inclines.','Return by extending the hips without leaning backward at the finish. Reset your position between repetitions when required.'],
['Avoid reaching farther than you can maintain your trunk position.','Do not treat a rack pull, stiff-leg variation and floor deadlift as identical setups.']);
add('hip-thrust',/hip thrust|glute bridge/i,
'A hip-extension movement for the glutes. A floor bridge supports the upper body on the ground; a hip thrust uses a bench or machine support.',
['Set the upper-body support and foot position. Secure and pad any load across the hips.','Raise the hips while keeping the ribs controlled, finishing with the trunk and thighs aligned.','Lower deliberately and reset without bouncing off the floor or machine.'],
['Avoid finishing by arching the lower back.','Keep the support stable and the load centered.']);
add('glute-kickback',/glute kickback|^cable kickback/i,
'A hip-extension movement that sends the working leg backward while the pelvis stays steady. Cable and machine versions provide external resistance.',
['Secure the ankle cuff or machine support and hold a stable position.','Move the working leg backward from the hip through the prescribed range.','Bring the leg back slowly without allowing the resistance to pull your pelvis around.'],
['Avoid turning the pelvis or arching the back to create more range.','Keep the attachment secure throughout the movement.']);
add('swing',/kettlebell swing/i,
'A dynamic hip-hinge movement. Hip extension drives the kettlebell while the arms guide its path; it is distinct from a slow front raise.',
['Set a stable stance and secure grip, with space in front of and behind you.','Hinge at the hips and let the kettlebell travel back, then extend the hips to drive it forward.','Allow the bell to return into the hinge while maintaining control of your stance and trunk.'],
['Avoid lifting the bell with a shoulder raise.','Use the swing height and progression assigned by your coach.']);
add('calf',/calf|calves/i,
'An ankle plantar-flexion movement that raises the heel against resistance. Bent-knee and straight-knee versions emphasize the calf muscles differently.',
['Set the support and secure the forefoot on the surface or platform. Use the knee position specified in your plan.','Raise the heels through a controlled range without rolling the ankles outward.','Lower slowly to the prescribed starting position.'],
['Avoid bouncing through the bottom of the repetition.','Keep forefoot contact secure, especially on an elevated edge.']);
add('back-extension',/hyperextension|back extension/i,
'A supported extension movement for the posterior chain. Pad height and the coach-assigned spinal or hip emphasis determine the exact execution.',
['Adjust the support to the intended movement and secure your feet.','Lower through the range specified by your coach while keeping the movement controlled.','Return to the planned body alignment without throwing the torso upward.'],
['Avoid finishing in an exaggerated backward arch.','Confirm whether the plan calls for hip movement or a specific spinal-extension variation.']);
add('pulldown',/lat pulldown|pull.?ups?|chin.?ups?/i,
'A vertical pulling movement for the back and elbow flexors. Pull-ups move the body toward a fixed bar; pulldowns bring a cable handle toward the body.',
['Take the named grip and secure the support or thigh pad. Set assistance or resistance before starting.','Draw the elbows down as the body rises or the handle lowers, keeping the torso controlled.','Return gradually to the planned start position without dropping or letting the stack crash.'],
['Avoid swinging or pulling with a sudden neck movement.','Use the grip width and assistance specified for your variation.']);
add('pullover',/pullover|straight.arm.*pulldown/i,
'A shoulder-extension movement in which the upper arms travel from an overhead or forward position toward the torso. Cable, machine and dumbbell versions have different support requirements.',
['Set your body support and grip for the named equipment. Keep the elbow bend consistent.','Move the upper arms through the assigned arc while controlling the ribcage.','Return slowly without allowing the load to pull you into an excessive overhead stretch.'],
['Avoid creating range by arching the lower back.','Do not repeatedly bend and straighten the elbows as in a triceps extension.']);
add('row',/\brow\b|rows$/i,
'A horizontal pulling movement for the back and elbow flexors. The named support, grip and elbow path determine the emphasis of the row.',
['Establish the seated, hinged or chest-supported position specified by the exercise.','Pull the handles or load toward your body while keeping the torso stable.','Let the arms return under control, maintaining the chosen body position.'],
['Avoid jerking the torso to start the pull.','In a Pendlay row, reset the load on the floor between controlled repetitions.']);
add('curl',/curl/i,
'An elbow-flexion movement for the upper arm. Palm position, arm support and shoulder position distinguish straight-bar, hammer, reverse and preacher variations.',
['Take the named grip and set any bench or upper-arm support.','Bend the elbows to raise the load, keeping the upper arms in the intended position.','Lower under control rather than allowing the elbows to snap straight.'],
['Avoid swinging the torso or shifting the shoulders to lift more weight.','Keep the wrist aligned; neutral, reverse and supinated grips are distinct variations.']);
add('triceps',/tricep|skull crusher|pushdown|overhead extension/i,
'An elbow-extension movement for the triceps. Overhead, lying and pushdown variations place the upper arm in different positions.',
['Set the cable, bench or machine for the named variation and position the upper arms.','Straighten the elbows against the resistance while keeping the upper arms controlled.','Bend the elbows to return slowly to the planned range.'],
['Avoid turning the movement into a shoulder press or bodyweight swing.','For a lying or overhead variation, maintain a secure grip and comfortable shoulder position.']);
add('side-plank',/side plank/i,
'A lateral trunk hold that challenges the muscles along the side of the abdomen and hip. Bent-knee and full-length versions use different levers.',
['Place the supporting elbow below the shoulder and set the feet or knees for your version.','Lift the hips into alignment and hold the trunk steady while breathing.','Lower with control when the prescribed hold ends or alignment can no longer be maintained.'],
['Avoid sinking into the supporting shoulder.','Keep the pelvis from rolling forward or backward.']);
add('plank',/plank/i,
'An isometric trunk exercise. The body stays supported in a steady position while the abdominal muscles resist unwanted movement.',
['Set the forearm or hand support and the knee or foot position required by your variation.','Keep the trunk and pelvis aligned as you hold and breathe steadily.','Finish the hold before alignment breaks down, then lower with control.'],
['Avoid holding the breath for the entire effort.','Do not let the hips sag or the head drop.']);
add('deadbug',/dead.?bug|heel slide|pelvic tilt/i,
'A supported core-control movement that coordinates the limbs while the pelvis and lower trunk remain steady.',
['Lie in the starting position assigned for the variation and establish the planned pelvis and rib position.','Move the named arm or leg slowly while maintaining that trunk position.','Return to the start and repeat on the other side when required.'],
['Avoid extending farther than you can control your trunk.','Use a steady breath rather than rushing the movement.']);
add('bird-dog',/bird.?dog|quadruped/i,
'A trunk-stability movement from an all-fours support, coordinating an arm or leg reach without rotating the pelvis.',
['Set your hands under your shoulders and knees under your hips.','Reach the assigned limb or opposite arm and leg while keeping the pelvis steady.','Return carefully to the supported start position.'],
['Avoid rotating the hips to lift the leg higher.','Keep your head aligned with your trunk.']);
add('rollout',/ab wheel|rollout/i,
'An anti-extension core exercise in which the body lengthens as the hands or wheel travel away. The abdominal muscles control the changing lever.',
['Set the support and grip for your assigned progression.','Roll or reach away only as far as you can keep the trunk controlled.','Draw back to the start without collapsing through the lower back.'],
['Avoid selecting a range you cannot reverse with control.','Keep the progression matched to your coach’s prescription.']);
add('leg-raise',/leg raise|knee raise|toes to bar|flutter kick|v.ups?/i,
'A leg-lifting core movement that combines hip flexion with trunk control. Lying, hanging and combined torso-and-leg variations require different supports.',
['Set the floor, bench or hanging support named in the exercise and establish a stable trunk.','Raise the leg or knees through the assigned range without creating uncontrolled momentum.','Lower gradually, preserving the intended pelvis and trunk position.'],
['Avoid swinging from a hanging support.','Keep the range short enough to control the lowering phase.']);
add('rotation',/twist|woodchop|wood chop|landmine rotation/i,
'A controlled rotational trunk movement. The named stance and implement determine whether the hips rotate with the trunk or remain more stable.',
['Set the stance, support and load for the named variation.','Move through the planned rotation with controlled hips and ribcage.','Return gradually before repeating on the other side.'],
['Avoid using momentum to force the end of the range.','Follow the prescribed hip movement rather than twisting the lower back abruptly.']);
add('crunch',/crunch|sit.?up/i,
'A trunk-flexion movement for the abdominal muscles. A crunch uses a shorter torso curl; sit-ups and reverse crunches change which body segment moves.',
['Set the mat, machine or cable support for your variation.','Curl the ribcage or pelvis as specified, keeping the movement controlled.','Return slowly instead of letting the torso or hips fall back.'],
['Avoid pulling on the head or neck.','Do not replace a controlled curl with a swinging sit-up.']);
add('mountain-climber',/mountain climber/i,
'A moving plank variation that alternates knee drives while the upper body stays supported.',
['Set a strong hand-supported plank on a stable surface.','Bring one knee forward while controlling the trunk and shoulders.','Return that foot and switch sides at the pace in your plan.'],
['Avoid bouncing the hips as the legs switch.','Keep hand contact secure throughout the interval.']);
add('rowing',/rowing machine|rower|erg.*row/i,
'A cyclical rowing movement that links leg drive, trunk movement and an arm pull, then reverses that sequence for the recovery.',
['Adjust the foot supports and secure the straps. Take a relaxed but secure handle grip.','Drive with the legs, then add the trunk and arms as the handle approaches the body.','Extend the arms, hinge forward and bend the knees to recover without rushing the slide.'],
['Avoid pulling early with the arms before using the legs.','Keep the return controlled rather than crashing into the front stop.']);
add('ski',/skierg|ski simulator|ski erg/i,
'A repeated double-pole pulling pattern for whole-body conditioning, using the arms and trunk with a controlled lower-body contribution.',
['Take a stable stance and secure both handles.','Pull the handles down with coordinated arm and trunk movement.','Allow the handles to return under control and repeat at the assigned pace.'],
['Avoid yanking the handles with the shoulders alone.','Keep your footing stable as fatigue increases.']);
add('cycling',/\bcycling\b|\bbike\b|spinning/i,
'A repeated pedaling activity for cardiovascular conditioning. Indoor and outdoor versions differ in balance, resistance and environmental demands.',
['Set a suitable saddle and handlebar position and check the equipment before starting.','Pedal smoothly at the effort and duration assigned in your plan.','Ease the effort before finishing and dismount or stop safely.'],
['Avoid rocking the pelvis because the saddle is too high.','An indoor resistance target does not translate directly to road conditions.']);
add('walking-running',/^(?!.*lunges?).*(?:running|treadmill|walking|jogging)/i,
'A walking or running activity for cardiovascular conditioning. Pace, incline, terrain and interval structure determine the workload.',
['Check the surface or treadmill and begin at an easy, controlled pace.','Build to the pace or effort assigned by your coach while maintaining a comfortable stride.','Reduce the pace before stopping; on a treadmill, use the controls before stepping away.'],
['Avoid increasing speed and incline beyond the assigned progression.','Treat uneven outdoor surfaces differently from a moving treadmill belt.']);
add('climber',/stair|stepper|step machine|vertical climb/i,
'A repetitive stepping or climbing activity that combines cardiovascular work with lower-body effort.',
['Set the machine and take secure support while starting.','Step rhythmically at the prescribed pace, keeping your weight over the working foot.','Slow the machine before stepping off.'],
['Avoid hanging your bodyweight from the handrails.','Place the foot securely rather than rushing short, unstable steps.']);
add('elliptical',/elliptical|arc trainer/i,
'A supported cyclical stepping activity for conditioning, with a guided foot path and optional moving handles.',
['Step onto the machine with the handles supported and choose a manageable starting resistance.','Move smoothly through the machine’s path at the assigned effort.','Ease the pace and wait for the pedals to slow before stepping off.'],
['Avoid shifting all of your weight onto the handles.','Keep the feet supported throughout each cycle.']);
add('jump-rope',/jump rope|skipping/i,
'A repeated low-jump activity that coordinates rope rotation, rhythm and foot contact for conditioning.',
['Use a clear surface and a rope length that suits you.','Turn the rope mainly from the wrists and make small controlled jumps.','Maintain the assigned rhythm and stop to reset if the rope catches.'],
['Avoid unnecessary high jumps that disrupt the rhythm.','Keep enough space from equipment and other people.']);
add('battle-rope',/battle rope/i,
'A conditioning movement that creates repeated waves in anchored ropes while the stance and trunk stay controlled.',
['Check the anchor and hold a rope end in each hand with a stable stance.','Create the alternating or simultaneous waves assigned in your plan.','Maintain the rhythm for the prescribed interval, then lower the ropes with control.'],
['Avoid repeatedly arching the lower back to make larger waves.','Use the wave pattern assigned by your coach.']);
add('broad-activity',/swimming|hiit|interval training|kickboxing|dance|zumba|aerobic|boxing drills|circuit training|plyometric drills/i,
'This record describes an activity category rather than one standardized exercise. Its movements, work intervals and progression depend on the session your coach assigns.',
['Open the assigned session and identify the specific movements or activity format.','Use its written duration, intensity, work and recovery instructions.','Record any questions or difficulties in your weekly check-in so the next session can be adjusted.'],
['A category title is not a complete technique prescription.','Confirm the exact drills or movement sequence before starting.']);
const detailedGuides={"ex_644a0823f821":{"description":"An overhand-grip curl on a guided Smith bar. It trains elbow flexion with an emphasis on the brachioradialis and forearms. Use a light load and a bar path that lets the wrists stay neutral.","steps":["Set the safety stops and take an overhand grip about shoulder width apart. Stand so the bar clears your thighs.","Keep the upper arms close to your sides and bend the elbows through a comfortable range. Do not drive the bar with your hips.","Lower the bar slowly, then re-rack it securely before releasing your grip."],"checks":["Keep the wrists straight rather than folding them over the bar.","The fixed track must suit your position; do not force the shoulders to follow an uncomfortable path."]},"ex_9752202eae8f":{"description":"A coach-prescribed curl setup using an incline bench and a Smith bar. The guided track differs from a free dumbbell curl, so bench placement, clearance and the permitted range need to suit the machine.","steps":["Position the bench and safety stops as assigned by your coach. Check that the bar clears the thighs and knees before loading it.","Sit with the back supported and feet planted. Take an underhand grip and keep the wrists aligned with the forearms.","Curl only through the assigned comfortable range, lower with control and re-rack the bar before standing up."],"checks":["The photograph shows the starting setup, not the end of a repetition.","Do not copy the range of a free dumbbell curl onto a fixed Smith track."]},"ex_98fd264a72a6":{"description":"A machine-specific elbow-flexion variation using high-row handles. This is not a standard high-row prescription: your coach should confirm that the handle path and setup are suitable for the intended curl.","steps":["Set the seat, chest support and a light load. Confirm the intended grip and curl path with your coach.","Keep the torso supported and bend the elbows through the assigned range without pulling the whole body backward.","Return the handles slowly and keep control until the lever reaches its resting position."],"checks":["Keep the curl distinct from a heavy rowing movement.","The setup photo does not establish the correct working range for every high-row machine."]},"ex_493faf3c91a8":{"description":"A pull-up with both hands placed one in front of the other on the same bar. The body faces along the bar and the head passes beside it, creating a narrow alternating-side pulling pattern.","steps":["Use a stable step to take a tandem grip on one straight bar, with one hand directly in front of the other. Establish control before leaving the step.","From a controlled hang, draw the elbows down and pull the head beside the bar without swinging or craning the neck.","Lower slowly. Alternate the side of the bar and change the leading hand as prescribed for balanced practice."],"checks":["A shoulder-width grip across the bar is a different pull-up variation.","Keep enough head clearance and avoid twisting the trunk to finish a repetition."]},"ex_d3a7234f9a06":{"description":"Short backward steps on the balls of the feet against a low cable attached to a waist belt. The calves maintain heel elevation while the hips and trunk control the backward movement.","steps":["Attach the belt securely to the low pulley in front of you. Clear the walking area and start with a light resistance.","Raise the heels slightly and take short, controlled backward steps on the balls of the feet while keeping the trunk upright.","Return toward the stack under control, following the assigned distance or duration."],"checks":["Keep the cable clear of the feet throughout the walk.","Avoid leaning far backward or letting the weight stack pull you forward suddenly."]},"ex_96767536b058":{"description":"An overhand cable curl that trains the elbow flexors, with a strong forearm and brachioradialis contribution. The low pulley maintains resistance while the upper arms stay beside the torso.","steps":["Attach a straight bar to the low pulley. Stand facing the stack and take a shoulder-width overhand grip with palms down.","Keep the elbows close to the ribs and curl the bar without lifting the shoulders or bending the wrists.","Lower the bar slowly until the elbows are nearly straight, maintaining control of the stack."],"checks":["Keep an overhand grip; turning the palms up changes the variation.","Let the elbows bend while the upper arms and trunk remain quiet."]},"ex_ea2f1d0f1b49":{"description":"A hip hinge performed while holding a handle connected to a low pulley in front of the body. The hamstrings and glutes control the hinge as the cable draws the handle forward toward the stack.","steps":["Face the low pulley, hold the handle with both hands and stand far enough away to keep tension. Soften the knees and brace the trunk.","Send the hips backward while keeping the arms long and the spine neutral. Stop at the range you can control without rounding the back.","Drive through the feet and bring the hips forward to stand tall, without leaning back at the top."],"checks":["The cable pulls the handle forward toward the stack, not backward behind the hips.","Keep this a hip hinge rather than a deep squat or an arm row."]},"ex_6fe866f56471":{"description":"A side-lying cable clamshell setup from the exercise catalogue. Cuff placement and cable direction change the resistance, so your coach must confirm them for the intended hip movement. The photograph shows setup only.","steps":["Confirm the cuff placement, pulley direction and working leg with your coach before loading the cable.","Lie on your side with the hips stacked and knees bent. Establish a stable pelvis and the prescribed foot position.","Open the upper knee only through the assigned controlled range, keeping the pelvis still, then return slowly."],"checks":["An ankle cuff is not interchangeable with a band placed above the knees.","Do not infer the loaded movement or resistance direction from the setup photograph alone."]},"ex_33ba062b2cfe":{"description":"A single-leg hip hinge with a dumbbell in the hand opposite the supporting leg. The hamstrings and glutes control the hinge while the trunk and hip stabilizers resist rotation.","steps":["Stand on one foot with a soft knee. Hold one dumbbell in the opposite hand and find a stable, balanced position.","Hinge the hips backward as the free leg reaches behind you. Keep the pelvis facing the floor and let the weight hang beneath the shoulder.","Press through the supporting foot to return upright without twisting. Reset your balance before the next repetition."],"checks":["For a left supporting leg, the dumbbell belongs in the right hand, and vice versa.","Keep the back neutral and stop before the pelvis opens to the side."]},"ex_d9b5897bda2d":{"description":"A seated knee-flexion exercise for the hamstrings. A thigh restraint holds the legs in position while a roller behind the lower calves resists the curling movement.","steps":["Adjust the seat so the knees align with the machine pivot. Place the lower roller behind the calves above the heels and secure the thigh restraint above the knees.","Keep the back supported and curl the lower legs down and back through a comfortable range.","Return slowly toward the starting position without letting the weight stack drop."],"checks":["The working roller belongs behind the lower calves, not across the front of the shins.","Keep the hips on the seat and avoid lifting the thighs against the restraint."]},"ex_b61f370981de":{"description":"A suspended hamstring curl with each heel supported by a separate gymnastic ring. The hamstrings bend the knees while the glutes and trunk help hold a controlled bridge.","steps":["Secure two rings at equal low height. Lie on your back, support one heel in each ring and keep the arms on the floor for balance.","Raise the hips into a controlled bridge and draw the heels toward the body by bending the knees.","Extend the legs slowly while maintaining control of the hips, then lower and reset as needed."],"checks":["Keep both heels supported and the straps stable throughout the movement.","Use a range that lets the hips stay controlled without arching the lower back."]},"sheet_39ab10466907":{"description":"A machine pullover that moves the upper arms from an overhead position toward the torso. The lats drive the shoulder movement while the trunk stays supported and the elbow angle remains mostly steady.","steps":["Adjust the seat, pads and starting range for the machine. Sit with the back supported and place the arms on the intended contact surfaces.","Bring the upper arms down toward the torso without turning the movement into an elbow extension or a trunk crunch.","Return overhead slowly within a comfortable shoulder range and keep the ribs controlled."],"checks":["Avoid arching the lower back to gain extra range.","Machine handles and pads vary; follow the setup for the actual machine in your gym."]},"sheet_d80696b831ac":{"description":"A standing glute kickback with a low cable attached to the working ankle. The glutes extend the hip while the supporting leg and trunk keep the pelvis steady. This entry describes the ankle-cuff hip exercise, not a triceps kickback.","steps":["Attach an ankle cuff to the low pulley and face the stack. Hold a stable support and soften the knee of the standing leg.","Move the working leg a short distance backward from the hip while keeping the pelvis level and the trunk steady.","Return the leg slowly without letting the cable pull you off balance. Complete the assigned repetitions before changing sides."],"checks":["Keep the cable attached to the working ankle and clear of the standing foot.","Do not lift the leg so high that the lower back arches or the pelvis rotates."]}};
const profiles=Object.values(guides);
const forearmGuide={id:'forearm',description:'A forearm-focused movement for wrist, finger or forearm control. Wrist flexion, extension and rotation are separate movement directions, so use the exact named variation.',steps:[],checks:['Keep the forearm supported or steady as specified in the variation.','Control the small movement instead of using momentum from the upper arm.']};
function clean(text){return String(text||'').replace(/^\d+\.\s*/,'').replace(/\s*\(\d+\s+(?:Exercises|Movements)\)\s*$/i,'').trim();}
function get(x){
 const detail=detailedGuides[x.exercise_id];
 const cardioIds=['rowing','ski','cycling','walking-running','climber','elliptical','jump-rope','battle-rope','broad-activity'];
 let profile=profiles.find(p=>cardioIds.includes(p.id)&&p.match.test(x.name))||profiles.find(p=>p.match.test(x.name));
 if(/wrist|finger|pronation|supination|radial|ulnar/i.test(x.name)&&x.muscle_groups.includes('Forearms'))profile=forearmGuide;
 if(profile?.id==='curl'&&x.muscle_groups.includes('Hamstrings'))profile=guides['leg-curl'];
 const original=String(x.biomechanics_cue||'').trim();
 const sourceSteps=original.split(/;\s*|\.\s+(?=[A-Z])/).map(t=>t.trim()).filter(Boolean).map(t=>t[0].toUpperCase()+t.slice(1).replace(/\.$/,'')+'.');
 const muscle=x.primary_muscle&&!/not (?:specified|classified)/i.test(x.primary_muscle)?x.primary_muscle:null;
 const description=String(x.description||'').trim()||detail?.description||profile?.description||(muscle?`A ${x.category==='Cardio'?'conditioning':'strength'} reference focused on ${muscle}. ${x.secondary_muscles.length?'Supporting muscles include '+x.secondary_muscles.join(', ')+'.':''}`:`A reference from the ${x.muscle_groups.join(' / ')} catalogue. Use the named equipment and movement variation in your assigned plan.`);
 const written=Array.isArray(x.instructions)&&x.instructions.some(t=>t.trim());
 return {description,steps:written?x.instructions:detail?.steps||(sourceSteps.length?sourceSteps:profile?.steps||[]),checks:detail?.checks||profile?.checks||[],basis:written?'Written exercise instructions':detail?'Exercise-specific guide':sourceSteps.length?'From the exercise catalogue':'Movement-family guide',movement:clean(x.modality),specific:!!detail||written||sourceSteps.length>0,profile:profile?.id||null};
}
window.PandaGuides={exercise:get};
})();
