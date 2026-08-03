# Jonathan Coulton — 3 August 2026

First outside reader. Musician; runs JoCo Cruise, so he speaks as both someone
who attends events and someone who organises one. Replying to an emailed
description of the idea, not to the deployed app.

His feedback is preserved in full at the bottom. This section is triage.

---

## The one that matters most

> "JoCo Cruise" can be subdivided into years, but then also days within each
> year, but also events within days. And of course it happens in many different
> places over the course of the week. […] If I'm uploading photos of the parking
> lot hang at a Weird Al show, what moment is that?

**Status: Fork.** This is a direct hit on the current model and worth sitting
with before building anything else.

A moment today is exactly **one place on one day**. That handles a concert
cleanly. It handles his examples badly:

- **A cruise moves.** Over a week it visits several ports. "Place" isn't stable,
  so the thing people would call "JoCo Cruise 2017" can't be one moment.
- **Festivals nest.** Bumbershoot → a day → a stage → a set. One level of
  granularity forces a choice between a page too broad to browse and pages too
  narrow to pool.
- **The parking lot hang has no obvious home.** It belongs to the Weird Al show
  socially, but not to the venue-and-stage where the show happened.

Worth noting the failure is asymmetric. Tag too broadly and a day's photos
drown in a week's; tag too narrowly and nobody else picks the same page, which
is the silent-fragmentation failure the whole design was built to avoid.

Possible directions, none obviously right:

1. **Nested moments** — a moment can have a parent. `JoCo Cruise 2017` contains
   `Day 3`, which contains `Main Stage, 9pm`. Genuinely models reality; adds a
   hierarchy for people to disagree about.
2. **Date ranges instead of single dates** — a moment spans 18–25 July. Cheap,
   solves the cruise and the family vacation, doesn't solve nesting.
3. **A named container tag above place** — an `event` facet joining who / where /
   when. Fits the existing model; risks the same fragmentation the other facets
   already fight.
4. **Leave it alone** and let topic tags carry the nuance. Simplest; probably
   inadequate for anything longer than one night.

Not a decision to take quickly.

---

## Already built

| His suggestion | Reality |
|---|---|
| **Normalization** of tags to prevent duplicates | Built. Slugs fold case, whitespace, punctuation and accents, so "Aimee Mann" / "aimee mann" / "AIMEE MANN" are one tag, enforced by a uniqueness constraint. Typeahead shows existing tags with upload counts while you type. |
| **Pull time from photos** | Built. EXIF capture date is read and prefills the date field. |
| **Moments defined broadly** — conferences, vacations, weather events, rainbows | Already works. Nothing in the schema is music-specific; the facets are just who / where / topic plus a date. A family vacation is a valid moment today. Worth telling him. |

---

## Genuine gaps, ordered by value against effort

### Fuzzy matching — "did you mean?"

> the software looks for fuzzy matches and says "did you mean this?"

**Status: Partial.** Normalization only catches differences that vanish under
folding. **"Aimee Man" with one N creates a brand new tag**, and so does
"Bumbershot". The typeahead helps only if you type enough of a correct prefix.

An edit-distance check against existing tags in the same facet, surfaced as
"did you mean Aimee Mann?", closes the remaining hole. Small, self-contained,
and it protects the mechanic everything else depends on. **The best next thing
to build.**

### Auto-matching by location and time

> if you build out moments to include a range of time and place, you can auto
> match photos as they come in

**Status: Partial — closer than he thinks.** GPS coordinates are *already*
extracted from EXIF and stored on every upload. Nothing reads them yet.

So "you were within this area on this date, is this the Bumbershoot moment?"
needs a matching query and a confirmation step, not new data collection. Depends
on the moment model above, since it needs moments to have extent rather than a
single point.

### Friends

> I don't want to see everyone's photos at the Aimee Mann show, just my friends
> that I went with. "Wellfleet between July 18 and August 1 with just my
> friends" is a complete slideshow of my family vacation in a single search.

**Status: Fork, not a feature.** Following exists for tags and moments; there is
no concept of a person following a person.

This is the second big question in the email. Note the tension: the product's
entire premise is that *strangers* pool around a place and a date. A friend
filter is a different product — closer to shared albums, which is the crowded
category the current design deliberately avoids.

Both can coexist (pool publicly, filter to friends), but it changes the centre
of gravity, and his commercial argument for it is strong: keeping up with people
you know is a far more reliable habit than browsing strangers' concert photos.

### Batch upload from your library

> find all the photos in my library from that place and time and start a batch
> upload for me

**Status: Open.** Currently one file at a time, which is painful with twenty
photos from one night. Multi-select is straightforward. Reading the phone's
library by place and time needs a native app.

### Search

**Status: Open.** Not in his list, but implied throughout. You browse by
clicking chips; you can't type "aimee". Cheap and conspicuously missing.

### Embeddable galleries

> Give me the javascript that I can copy and paste onto my website or newsletter

**Status: Open.** Strong distribution idea — every embed is a link back. Worth
noting for an artist audience specifically, since they all have sites and
newsletters.

### Artist and organiser accounts, moments created in advance

> giving artists their own special log in so they can import their concert
> calendar and set up and promote moments in advance […] a conference
> encouraging every attendee to upload photos to Moments they create

**Status: Open.** Also the most concrete revenue idea in the email, and it comes
from someone who would be the customer. Directly addresses cold start: a moment
that exists *before* the event, promoted by the artist, has something in it when
the first attendee arrives.

### Everything else

| Item | Status | Note |
|---|---|---|
| Notifications / "200 people here are uploading" | Open | Needs a native app for location awareness |
| Import or cross-post from Instagram | Open | He's right that platforms have closed these paths |
| Filters, music, reels | Open | Table stakes for a younger audience |
| Daily mindfulness prompt | Open | Interesting; a different product |
| Facial recognition | Open | He flags the privacy problem himself. Avoid |
| Interesting-data queries ("dogs in pride parades over the years") | Open | Falls out of the faceted model once there's data volume |
| Feeds and algorithms | Open | Only if the answer to monetisation is ads |

---

## The business challenges

He is explicitly not sugar-coating these, and they shouldn't be filed as
features. Summarised, with an honest note on where things stand:

**Software is hard — the future is the hard part.** Support, compliance,
infrastructure, bugs, multiple platforms, legal. Correct. Some groundwork is
done (moderation tools, published rules and takedown process, storage and
database behind adapters), but the ongoing labour he describes is real and
doesn't shrink.

**The social graph is the real value, and new social is brutal.** *"What gets
someone to post to your app instead of Instagram?"* The current answer — your
photo finds the other people who were there, which Instagram structurally
cannot do — is a real answer, and completely untested.

**Monetisation shapes the software.** *"If you build something that's cool and
useful and does just what people want, it's hard to earn money."* His point that
ads would drag the product toward engagement metrics is worth taking seriously
*before* choosing that path. The artist and venue direction above may be the way
to avoid it.

**The moat.** *"If you can vibe code it, so can anyone else."* Unanswered, and
honestly so in the project paper. Instagram could group by place and date
tomorrow. The only defences available are being the place people expect this to
work, and the archive that accumulates — neither of which is technology, and
both of which need time and users.

---

## Where this leaves the roadmap

Reading it as one list, in order:

1. **Decide the moment model.** Nesting, ranges, or neither. Everything about
   location auto-matching depends on it, and it gets harder to change once
   people have tagged things.
2. **Fuzzy matching.** Small, closes a real hole, protects the core mechanic.
3. **Search.** Cheap and obviously missing.
4. **Decide about friends.** A product-shape question, not a feature request.
5. **Artist and organiser accounts.** Addresses cold start and revenue together,
   from a person who would pay for it.

---

## Original message, unedited

> Just some initial thoughts about features you might want to add - I'm sure
> you've already thought about a lot of these. Some of these are more problems
> than solutions, but that's software for you!
>
> **Data normalization** - you want to minimize duplicate tags and moments due to
> misspellings or alternate naming or different punctuation. This probably means
> some kind of robust flow during upload, where the software looks for fuzzy
> matches and says "did you mean this?"
>
> **More robust moments** - joco cruise is a good example. "JoCo Cruise" can be
> subdivided into years, but then also days within each year, but also events
> within days. And of course it happens in many different places over the course
> of the week. If you let someone create a JoCo Cruise moment, you're making
> those photos harder to find for someone who wants to see JoCo Cruise 2017
> photos. Same thing with a festival - Bumbershoot, but which day, which stage,
> which concert? If I'm uploading photos of the parking lot hang at a Weird Al
> show, what moment is that? This relates to the above, but just the idea that
> you want some intelligent curation to happen. A million people uploading and
> tagging photos can turn into a real mess of data.
>
> **Pulling time and location data from photos** - it isn't always there, but
> sometimes it is, if they've enabled whatever privacy setting on their phones
> (which you'll need to encourage them to do). But the nice thing about this is,
> if you build out moments to include a range of time and place, you can auto
> match photos as they come in. So this is related to the above. If you know that
> Bumbershoot happened within this part of the map on these days, you can auto
> match and tag. More advanced would be some kind of facial recognition, but
> that's computationally expensive and weird on privacy (not sure if Facebook
> does this with tagging your friends in photos? I hate Facebook).
>
> **Friends** - even though this isn't the framing, I think you'll want a friend
> system. I don't want to see everyone's photos at the Aimee Mann show, just my
> friends that I went with. "Wellfleet between July 18 and August 1 with just my
> friends" is a complete slideshow of my family vacation in a single search.
> Cool. And I think in terms of compelling usage, it's hard to beat the idea that
> you're keeping up with what your friends are doing. If this is getting
> monetized, you want people spending a lot of time here, which, just browsing
> random stranger photos from the concerts you do to might not be enough.
>
> **Speaking of monetization** - if it's ads, you need eyeballs and engagement,
> which probably means feeds and algorithms. An endless scroll of "stuff you'd
> like," suggesting moments and people to follow, etc. This is quite a bit down
> the road, but worth thinking about how the data you're gathering and curating
> now will be useful in building this in the future.
>
> **Siphoning** - some of this user activity is already happening in other
> places. I haven't thought through this much, but it would be cool if you could
> help people auto cross post from instagram, or pull in things from instagram or
> other places. The other platforms have likely already made it difficult to do
> this, but it would be a useful thing if you could crack it.
>
> **Moments defined broadly** - looks like a lot of focus on
> concerts/festivals/artists right now, which makes sense. But people will use
> this for other things. A conference they attended, a disaster/weather event
> they saw, a family vacation, just a random moment where I felt cute/saw a
> rainbow, visiting this or that monument/park/mountain. You could keep it much
> more artist/concert focused, but I think there's a lot of juice elsewhere, and
> a lot of it you won't know until people start using it.
>
> **Future moments** - especially if this is artist centric, giving artists their
> own special log in so they can import their concert calendar and set up and
> promote moments in advance. But I could also see smaller uses, a conference
> encouraging every attendee to upload photos to Moments they create around the
> event: Day 1, Keynote Speaker, After Party, etc.
>
> **Interesting data** - the more you can gather and normalize this stuff, the
> more you can do cool things. Show me everything my friends did on July 4, dogs
> in pride parades over the years, similar photos of the leaning tower of Pisa,
> who was at the Pink concert at Bonaroo last year. This goes to monetization
> through more time spent in the app.
>
> **Code Snippets** - make it easy to share not just photos, but
> slideshows/galleries based on searches like the above. Give me the javascript
> that I can copy and paste onto my website or newsletter or medium post. Make it
> easy to share so that people want to share, and then it leads other people back
> to the app.
>
> **Reminders** - if your app is running in the background, maybe it knows you're
> at the Aimee Mann show and it pings you: 200 other people are here uploading
> photos.
>
> **Pull from my photos** - from the app, oh I was at this concert, find all the
> photos in my library from that place and time and start a batch upload for me
>
> **Mindfulness reminder** - once a day at a random time remind me to take a
> photo and add to my "My Life" moment.
>
> **Other photo sharing features** - you may want to consider all the other
> features in photo/video sharing apps: filters, captions, adding music to build
> a reel or a story, etc. The kids really like this sort of thing, and I think
> will notice if these features aren't there.
>
> Ok, and then the business challenges. Hopefully this doesn't come across as
> discouraging, but having spent some time building and selling software, I think
> there are some really fundamental things you should think about and be prepared
> for if you want to actually make this into a valuable app.
>
> **Software is hard** - building is the easy part, it's the future that is hard.
> Technical support, regulatory compliance, servers and infrastructure, fixing
> bugs and rolling out updates, adding and changing features, supporting multiple
> platforms (android? Desktop? Web?), keeping up with changing OSes and browsers,
> plus all the privacy, liability, and copyright legal stuff. All of this stuff
> is SO much more work than building the thing itself.
>
> **The social graph and user base is the real value** - launching new social
> media is hard. People get invested in what they're using the longer they use
> it, the more of their friends are on it. What gets someone to post to your app
> instead of Instagram? I don't know the answer, but this is a question that
> should drive your features and marketing and partnerships. What can't you do on
> those other platforms, and is that valuable enough to users that they want to
> switch?
>
> **Monetization** - I mentioned this above, but if it's ads, that changes the
> software. The curse of social media is, if you build something that's cool and
> useful and does just what people want, it's hard to earn money. This is why
> people make software that starts off great and gradually gets shittier and
> shittier. Ads means eyeballs, time spent, various metrics that you can show to
> advertisers to make it worth their while to pay you. Juicing those metrics
> often means adding features you wouldn't otherwise want. If this is an app that
> people buy, that's a different space, and probably you want to keep the pitch
> simple and focused, make it a compelling design and user interface, etc. And
> then you're really beholden to users liking it and reviewing it well, which
> makes the customer support, bug fixes, responding to user feature requests,
> etc. a lot more important.
>
> **The moat** - if you can vibe code it, so can anyone else. Think about what
> stops a company like Facebook from duplicating all the features in this app and
> adding it to instagram. This could be breakthrough tech that nobody knows how
> to do, an idea or technology that you have some legal ownership over, a
> dedicated user base that doesn't want to stop using your app because it's so
> beautiful and fun to use, or some other thing. But as I said above, in many
> ways, building the app is the easy part. There are companies that already have
> giant user bases, legal teams, server farms, armies of coders who are prepared
> to quickly eat your lunch.
>
> This was a lot longer than I thought it was going to be!
>
> -j
