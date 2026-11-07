
window.PANDA_ARTICLE_IMAGES=/*@data src/data/panda-article-images.json*/null;
Object.assign(window.PANDA_CAST.paths,{"assets/education/education-recovery.webp": {"female": "assets/education/education-recovery.webp", "male": "assets/editorial/recovery-male.webp"}, "assets/education/education-travel.webp": {"female": "assets/education/education-travel.webp", "male": "assets/editorial/travel-male.webp"}});
window.PANDA_CATALOGUE=/*@data src/data/panda-catalogue.json*/null;

window.PANDA_EXERCISE_CATEGORIES=[['Strength','Strength','قوة'],['Cardio','Cardio','كارديو'],['HIIT','HIIT','هيت'],['Warm-up','Warm-up','إحماء'],['Cool-down','Cool-down & stretching','تهدئة وإطالة']];
window.PANDA_LIBRARY_EXTENSION=/*@data src/data/panda-library-extension.json*/null;
(()=>{const known=new Set(window.PANDA_CATALOGUE.map(x=>x.exercise_id));for(const x of window.PANDA_LIBRARY_EXTENSION)if(!known.has(x.exercise_id))window.PANDA_CATALOGUE.push(x);for(const x of window.PANDA_CATALOGUE){if(x.exercise_id==='sheet_2cc6aee5d381')x.category='HIIT';if(x.exercise_id==='sheet_43f3b4bec685')x.category='Cardio';if(!x.category)x.category='Strength';if(['sheet_57b838251403','sheet_3167b332e7ca','sheet_f26e3046b2ac'].includes(x.exercise_id)){x.category='Strength';x.equipment='Cable';}}})();
/* PANDA_CARDIO_SWIMMING_EXTENSION_BEGIN */
window.PANDA_CARDIO_EXTENSION=/*@data src/data/panda-cardio-extension.json*/null;
(()=>{const known=new Set(window.PANDA_CATALOGUE.map(x=>x.exercise_id));for(const entry of window.PANDA_CARDIO_EXTENSION)if(!known.has(entry.exercise_id)){window.PANDA_CATALOGUE.push(entry);known.add(entry.exercise_id);}})();
/* PANDA_CARDIO_SWIMMING_EXTENSION_END */
(()=>{const cast=window.PANDA_CAST,paths=cast.paths,groups=new Map();cast.canonical={};for(const [base,pair] of Object.entries({...paths}))if(pair.male&&pair.female){const identity=groups.get(pair.male)||base;groups.set(pair.male,identity);paths[pair.male]=pair;paths[pair.female]=pair;cast.canonical[base]=identity;cast.canonical[pair.male]=identity;cast.canonical[pair.female]=identity;}})();
window.PANDA_SEED_BASE=/*@data src/data/panda-seed-base.json*/null;
