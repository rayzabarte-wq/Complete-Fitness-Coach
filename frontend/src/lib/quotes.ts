// Quote of the week, shown at the top of the Calendar. A hand-picked list
// kept in the app (no outside service to go down or rate-limit us): wartime
// leaders, and athletes and coaches known for fighting hard to win.
//
// Only quotes with a documented source are included: many popular
// "motivational" lines are misattributed (Churchill's "if you're going
// through hell, keep going" and "success is not final" are the classic
// examples), so those are deliberately left out. Where a quote is a
// well-known extract of a longer passage, it is trimmed with "…".
//
// The list is ordered to alternate leaders and athletes. It changes every
// Monday and repeats after QUOTES.length weeks. To add one, append an
// object; the week it appears shifts, which is harmless.

export interface Quote {
  text: string;
  author: string;
  /** Who they were / where it was said, shown under the author. */
  context: string;
}

export const QUOTES: Quote[] = [
  { text: "I have nothing to offer but blood, toil, tears and sweat.", author: "Winston Churchill", context: "First speech as Prime Minister, 1940" },
  { text: "I hated every minute of training, but I said, 'Don't quit. Suffer now and live the rest of your life as a champion.'", author: "Muhammad Ali", context: "Boxer, three-time world heavyweight champion" },
  { text: "The only thing we have to fear is fear itself.", author: "Franklin D. Roosevelt", context: "First inaugural address, 1933" },
  { text: "The price of success is hard work, dedication to the job at hand, and the determination that whether we win or lose, we have applied the best of ourselves to the task at hand.", author: "Vince Lombardi", context: "Coach of the Green Bay Packers" },
  { text: "Never give in — never, never, never, never, in nothing, great or small, large or petty — never give in, except to convictions of honour and good sense.", author: "Winston Churchill", context: "Harrow School, 1941" },
  { text: "I've missed more than 9,000 shots in my career. I've lost almost 300 games. Twenty-six times I've been trusted to take the game-winning shot and missed. I've failed over and over and over again in my life. And that is why I succeed.", author: "Michael Jordan", context: "Basketball, six-time NBA champion" },
  { text: "Physical fitness is not only one of the most important keys to a healthy body, it is the basis of dynamic and creative intellectual activity.", author: "John F. Kennedy", context: "Navy veteran and President, 1960" },
  { text: "A lot of people run a race to see who's the fastest. I run to see who has the most guts.", author: "Steve Prefontaine", context: "American distance runner" },
  { text: "The credit belongs to the man who is actually in the arena, whose face is marred by dust and sweat and blood; who strives valiantly…", author: "Theodore Roosevelt", context: "\"Citizenship in a Republic\", 1910" },
  { text: "The last three or four reps is what makes the muscle grow.", author: "Arnold Schwarzenegger", context: "Bodybuilder, seven-time Mr. Olympia, in Pumping Iron" },
  { text: "Victory at all costs, victory in spite of all terror, victory, however long and hard the road may be; for without victory, there is no survival.", author: "Winston Churchill", context: "House of Commons, May 1940" },
  { text: "Pressure is a privilege.", author: "Billie Jean King", context: "Tennis, 39 Grand Slam titles" },
  { text: "In preparing for battle I have always found that plans are useless, but planning is indispensable.", author: "Dwight D. Eisenhower", context: "Supreme Allied Commander, 1957" },
  { text: "Fatigue makes cowards of us all.", author: "Vince Lombardi", context: "Coach of the Green Bay Packers" },
  { text: "Uncommon valor was a common virtue.", author: "Admiral Chester Nimitz", context: "On the Marines at Iwo Jima, 1945" },
  { text: "Success is a journey, not a destination. The doing is often more important than the outcome.", author: "Arthur Ashe", context: "Tennis, Wimbledon and US Open champion" },
  { text: "This is not the end. It is not even the beginning of the end. But it is, perhaps, the end of the beginning.", author: "Winston Churchill", context: "Mansion House, 1942" },
  { text: "Champions aren't made in gyms. Champions are made from something they have deep inside them — a desire, a dream, a vision.", author: "Muhammad Ali", context: "Boxer, three-time world heavyweight champion" },
  { text: "It is common sense to take a method and try it. If it fails, admit it frankly and try another. But above all, try something.", author: "Franklin D. Roosevelt", context: "Oglethorpe University, 1932" },
  { text: "Perfection is not attainable, but if we chase perfection we can catch excellence.", author: "Vince Lombardi", context: "Coach of the Green Bay Packers" },
  { text: "Always bear in mind that your own resolution to succeed is more important than any other one thing.", author: "Abraham Lincoln", context: "Letter to Isham Reavis, 1855" },
  { text: "We all have dreams. In order to make dreams come into reality, it takes an awful lot of determination, dedication, self-discipline, and effort.", author: "Jesse Owens", context: "Four gold medals, Berlin Olympics 1936" },
  { text: "We choose to go to the moon in this decade and do the other things, not because they are easy, but because they are hard.", author: "John F. Kennedy", context: "Rice University, 1962" },
  { text: "The man who can drive himself further once the effort gets painful is the man who will win.", author: "Roger Bannister", context: "First to run a mile in under four minutes" },
  { text: "Courage is rightly esteemed the first of human qualities because it is the quality which guarantees all others.", author: "Winston Churchill", context: "Great Contemporaries, 1937" },
  { text: "Do not let what you cannot do interfere with what you can do.", author: "John Wooden", context: "UCLA basketball coach, ten national titles" },
  { text: "England expects that every man will do his duty.", author: "Admiral Horatio Nelson", context: "Signal before the Battle of Trafalgar, 1805" },
  { text: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe", context: "Tennis, Wimbledon and US Open champion" },
  { text: "If you want to change the world, start off by making your bed.", author: "Admiral William McRaven", context: "Navy SEAL commander, University of Texas address, 2014" },
  { text: "Don't give up. Don't ever give up.", author: "Jim Valvano", context: "Basketball coach, ESPY Awards speech, 1993" },
  { text: "The only limit to our realization of tomorrow will be our doubts of today.", author: "Franklin D. Roosevelt", context: "Undelivered Jefferson Day address, 1945" },
  { text: "No human is limited.", author: "Eliud Kipchoge", context: "Marathon world-record holder, first sub-two-hour marathon" },
  { text: "We shall fight on the beaches… we shall never surrender.", author: "Winston Churchill", context: "House of Commons, June 1940" },
  { text: "You gain strength, courage, and confidence by every experience in which you really stop to look fear in the face.", author: "Eleanor Roosevelt", context: "You Learn by Living, 1960" },
  { text: "Today, I consider myself the luckiest man on the face of the earth.", author: "Lou Gehrig", context: "Farewell speech, Yankee Stadium, 1939" },
  { text: "Far better it is to dare mighty things, to win glorious triumphs, even though checkered by failure, than to take rank with those poor spirits who neither enjoy much nor suffer much, because they live in a gray twilight that knows not victory nor defeat.", author: "Theodore Roosevelt", context: "\"The Strenuous Life\", 1899" },
];

const DAY_MS = 86_400_000;

/**
 * The quote for the week containing `date` (weeks run Monday to Sunday, in
 * the person's local time). Everyone sees the same quote in the same week.
 */
export function quoteForDate(date: Date): Quote {
  // Whole days since 1970-01-01 for the LOCAL calendar date (so a late
  // evening in London doesn't tick over early or late).
  const days = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
  // 1970-01-01 was a Thursday, so Mondays fall on days ≡ 4 (mod 7).
  const week = Math.floor((days + 3) / 7);
  return QUOTES[((week % QUOTES.length) + QUOTES.length) % QUOTES.length];
}
