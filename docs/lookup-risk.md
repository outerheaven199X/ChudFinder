# Country lookup: traffic and account risk

Version 3.3 defaults to passive Careful mode. It observes About pages the user opens and displays cached results automatically. It makes no background X visits on load, scroll, hover or investigation click. Auto remains an explicit optional choice that makes additional scripted About visits using the signed-in browser.

[X's automation rules](https://help.x.com/en/rules-and-policies/x-automation), checked October 30, 2026, prohibit scripting its website and warn of possible permanent suspension. The policy does not establish a permitted rate for these visits. An absence of reported bans would not establish approval or a measured probability of enforcement. No suspension probability has been measured for Chud Finder.

For the documented API, [X's rate-limit guidance](https://docs.x.com/x-api/fundamentals/rate-limits) describes per-endpoint limits, 429 responses and reset headers. Those API limits cannot be treated as permission or safe thresholds for automated website navigation.

The documented [User fields](https://docs.x.com/x-api/fundamentals/data-dictionary#user) include the profile's freeform location. The reviewed list does not document the About page's Account based in or App Store region fields. Profile location is not an equivalent replacement for those fields. No paid API test was needed to check that documentation.

[Pangram's extension description](https://www.pangram.com/solutions/chrome-extension) says it classifies content users browse with its own detector. The technical distinction is that classifying text already rendered in the feed does not inherently require additional X requests. This is an architectural inference from the description, not a network audit of Pangram or proof that no Pangram user has been restricted.

The implemented passive flow removes Chud Finder's extra automated page visits, but leaves unseen countries unresolved until the user opens About ↗. The extension then captures the displayed fields without manual entry. Auto's existing pacing, daily cap, cache and pause on recognized login/access prompts remain traffic controls, not a guarantee against restrictions. Optional approved API investigation actions remain separate and user-triggered; no country field is substituted or inferred to fill the coverage gap.
