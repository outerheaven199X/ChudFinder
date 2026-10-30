# Country lookup: traffic and account risk

The current country lookup makes additional X About page visits using the signed-in browser. Both Auto and Careful use this mechanism. Careful limits the trigger to hover, keyboard focus or click; it does not replace browser automation with an approved API.

[X's automation rules](https://help.x.com/en/rules-and-policies/x-automation), checked October 30, 2026, prohibit scripting its website and warn of possible permanent suspension. The policy does not establish a permitted rate for these visits. An absence of reported bans would not establish approval or a measured probability of enforcement. No suspension probability has been measured for Chud Finder.

For the documented API, [X's rate-limit guidance](https://docs.x.com/x-api/fundamentals/rate-limits) describes per-endpoint limits, 429 responses and reset headers. Those API limits cannot be treated as permission or safe thresholds for automated website navigation.

The documented [User fields](https://docs.x.com/x-api/fundamentals/data-dictionary#user) include the profile's freeform location. The reviewed list does not document the About page's Account based in or App Store region fields. Profile location is not an equivalent replacement for those fields. No paid API test was needed to check that documentation.

[Pangram's extension description](https://www.pangram.com/solutions/chrome-extension) says it classifies content users browse with its own detector. The technical distinction is that classifying text already rendered in the feed does not inherently require additional X requests. This is an architectural inference from the description, not a network audit of Pangram or proof that no Pangram user has been restricted.

A passive implementation could display cached results and observe About fields only when the user opens those pages. It would remove Chud Finder's extra automated page visits, but would leave previously unseen countries unresolved. It is not implemented as a new mode in this update. The existing pacing, daily cap, cache and pause on recognized login/access prompts remain traffic controls, not a guarantee against restrictions.
