// Simplified but structurally faithful copy of X's tweet markup (Oct 2026):
// article[data-testid=tweet] > ... > div[data-testid=User-Name] with a name row and a handle row,
// plus a quoted tweet whose User-Name block has no links (only "@handle" text).
exports.TWEET_HTML = `
<div data-testid="cellInnerDiv">
 <article data-testid="tweet" role="article" tabindex="0">
  <div><div>
   <div data-testid="User-Name">
     <div class="name-row"><div><a href="/jack" role="link"><div><span><span>jack</span></span></div></a></div></div>
     <div class="handle-row"><div><a href="/jack" role="link" tabindex="-1"><div><span>@jack</span></div></a></div>
       <div><span>·</span></div><div><a href="/jack/status/20"><time datetime="2006-03-21T20:50:14.000Z">Mar 21, 2006</time></a></div></div>
   </div>
   <div data-testid="tweetText"><span>just setting up my twttr</span></div>
   <div role="link" tabindex="0">
     <div data-testid="User-Name">
       <div class="name-row"><div><span><span>Quoted Person</span></span></div></div>
       <div class="handle-row"><div><span>@quoted_person</span></div></div>
     </div>
     <div data-testid="tweetText"><span>quoted text</span></div>
   </div>
  </div></div>
 </article>
</div>`;

// Shape copied from a recorded AboutAccountQuery response (see asmyshlyaev177/x-profile-location tests).
exports.about = (sn, about) => ({ data: { user_result_by_screen_name: { result: {
  __typename: 'User', core: { screen_name: sn, name: sn }, about_profile: about } } } });
