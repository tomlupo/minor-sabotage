// The history note (style guide §9: paper and ink only, no jokes, no animation). The text is
// the research file's draft, checked sentence by sentence against its sources
// (docs/research/arsenal.md, "History note draft"). Do not edit a fact here without
// editing it there first.

export const NOTE_EN = [
  "On 26 March 1943, near the Arsenal in Warsaw, where Bielańska, Długa and Nalewki streets meet, 28 scouts of the Grey Ranks' Storm Groups attacked a Gestapo prison truck. The action, code-named “Meksyk II”, was planned by Tadeusz Zawadzki “Zośka” and commanded by Stanisław Broniewski “Orsza”. Its aim was to free Jan Bytnar “Rudy”, arrested on 23 March and tortured by the Gestapo, as he was driven from their headquarters on Szucha Avenue back to Pawiak prison.",
  "At about 17:30 bottles of petrol set the truck on fire. After a fight with its escort the scouts opened it, and twenty-one prisoners were freed, Rudy among them. The German side lost four killed and nine wounded.",
  "Rudy died on 30 March 1943 of the injuries inflicted during his interrogation. That same day Maciej Aleksy Dawidowski “Alek”, shot in the stomach during the withdrawal, died in hospital. Tadeusz Krzyżewicz “Buzdygan” died of his wounds on 2 April. Hubert Lenk “Hubert” was caught during the withdrawal and later killed by the Germans.",
  "On 27 March 1943, in reprisal, the Germans shot 140 prisoners of Pawiak, Poles and Jews, in the prison courtyard.",
  "Zośka was killed on 20 August 1943 in an attack on a German border-police post at Sieczychy. The Home Army battalion formed from the Storm Groups was named “Zośka” after him. Orsza led the Grey Ranks from May 1943 to October 1944, fought in the Warsaw Uprising, survived the war and died in 2000. He later wrote a full account of the action, Pod Arsenałem (1957).",
];

export const NOTE_PL = [
  "26 marca 1943 roku pod warszawskim Arsenałem, u zbiegu ulic Bielańskiej, Długiej i Nalewek, 28 harcerzy z Grup Szturmowych Szarych Szeregów zaatakowało więźniarkę Gestapo. Akcję o kryptonimie „Meksyk II” zaplanował Tadeusz Zawadzki „Zośka”, a dowodził nią Stanisław Broniewski „Orsza”. Jej celem było odbicie Jana Bytnara „Rudego”, aresztowanego 23 marca i torturowanego przez Gestapo, podczas przewożenia go z siedziby Gestapo w alei Szucha z powrotem na Pawiak.",
  "Około 17.30 butelki z benzyną podpaliły ciężarówkę. Po walce z konwojem harcerze otworzyli jej klapę i uwolnili dwudziestu jeden więźniów, wśród nich „Rudego”. Straty niemieckie wyniosły czterech zabitych i dziewięciu rannych.",
  "„Rudy” zmarł 30 marca 1943 roku w wyniku obrażeń zadanych mu w śledztwie. Tego samego dnia zmarł w szpitalu Maciej Aleksy Dawidowski „Alek”, postrzelony w brzuch podczas odwrotu. Tadeusz Krzyżewicz „Buzdygan” zmarł z ran 2 kwietnia. Hubert Lenk „Hubert” został schwytany w czasie odwrotu i później zamordowany przez Niemców.",
  "W odwecie 27 marca 1943 roku Niemcy rozstrzelali na dziedzińcu Pawiaka 140 więźniów – Polaków i Żydów.",
  "„Zośka” poległ 20 sierpnia 1943 roku w ataku na strażnicę niemieckiej policji granicznej w Sieczychach. Utworzony z Grup Szturmowych batalion Armii Krajowej otrzymał od jego pseudonimu nazwę „Zośka”. „Orsza” od maja 1943 do października 1944 roku był naczelnikiem Szarych Szeregów, walczył w powstaniu warszawskim, przeżył wojnę i zmarł w 2000 roku. Jest autorem pełnego opisu akcji, książki „Pod Arsenałem” (1957).",
];

/** Photos shown with the note, in order (credits come from public/history/credits.json). */
export const NOTE_PHOTOS = ["rudy.jpg", "zoska.jpg", "alek.jpg", "orsza.jpg", "arsenal-1938.jpg", "dluga-1939.jpg", "arsenal-plaque.jpg"];

/** What became of the people in your squads, from the sources (for the roll call). */
export const FATES: Record<string, string> = {
  zoska: "Killed at Sieczychy, 20 August 1943.",
  slon: "Killed in the Warsaw Uprising, 23 September 1944.",
  anoda: "Died in communist custody, 7 January 1949.",
  bolec: "Survived the war; died in 2007.",
  alek: "Shot during the withdrawal; died 30 March 1943.",
  kolczan: "Killed in the Warsaw Uprising, 8 August 1944.",
  maciek: "Arrested 18 February 1944; disappeared.",
  buzdygan: "Died of his wounds, 2 April 1943.",
  hubert: "Caught during the withdrawal; killed by the Germans.",
  mirski: "Survived the war; died in 1998.",
  giewont: "Killed in the Warsaw Uprising, 30 August 1944.",
  kuba: "Killed in the Warsaw Uprising, 11 August 1944.",
  kadlubek: "Survived the war; died in 2008.",
  jur: "Survived the war; died in 2011.",
  kopec: "Survived the war; died in 2000.",
};

/** The same, in Polish, for the note's Polish page. */
export const FATES_PL: Record<string, string> = {
  zoska: "Poległ pod Sieczychami, 20 sierpnia 1943.",
  slon: "Poległ w Powstaniu Warszawskim, 23 września 1944.",
  anoda: "Zmarł w śledztwie komunistycznej bezpieki, 7 stycznia 1949.",
  bolec: "Przeżył wojnę; zmarł w 2007 roku.",
  alek: "Postrzelony podczas odwrotu; zmarł 30 marca 1943.",
  kolczan: "Poległ w Powstaniu Warszawskim, 8 sierpnia 1944.",
  maciek: "Aresztowany 18 lutego 1944; zaginął.",
  buzdygan: "Zmarł z ran, 2 kwietnia 1943.",
  hubert: "Schwytany podczas odwrotu; zabity przez Niemców.",
  mirski: "Przeżył wojnę; zmarł w 1998 roku.",
  giewont: "Poległ w Powstaniu Warszawskim, 30 sierpnia 1944.",
  kuba: "Poległ w Powstaniu Warszawskim, 11 sierpnia 1944.",
  kadlubek: "Przeżył wojnę; zmarł w 2008 roku.",
  jur: "Przeżył wojnę; zmarł w 2011 roku.",
  kopec: "Przeżył wojnę; zmarł w 2000 roku.",
};

/** Polish captions for the photos (the English ones are the subjects in credits.json). */
export const PHOTO_PL: Record<string, string> = {
  "rudy.jpg": "Jan Bytnar „Rudy” (1921–1943)",
  "alek.jpg": "Maciej Aleksy Dawidowski „Alek” (1920–1943)",
  "zoska.jpg": "Tadeusz Zawadzki „Zośka” (1921–1943)",
  "orsza.jpg": "Stanisław Broniewski „Orsza” (1915–2000)",
  "arsenal-1938.jpg": "Arsenał od rogu Długiej i Nalewek, 1938: sgraffito i arkady od strony Nalewek",
  "dluga-1939.jpg": "Ulica Długa spod Arsenału w stronę wschodnią, jesień 1939: Arsenał i wypalony Pasaż Simonsa (po lewej), Długa 53–45 do rogu Bielańskiej (po prawej)",
  "arsenal-plaque.jpg": "Tablica z 1968 roku na murze Arsenału, Długa 52 (podaną na niej liczbę 25 uwolnionych więźniów poprawiono później na 21)",
  "arsenal-memorial-stone.jpg": "Kamień pamiątkowy ze znakiem Polski Walczącej przed Arsenałem, odsłonięty w 1993 roku; za nim, na murze, tablica z 1968 roku",
};
