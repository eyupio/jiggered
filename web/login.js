const e = new URLSearchParams(location.search).get("e");
const msg = {
  bad: "That username or password didn't match. Try again. (After ten wrong tries an account is paused for 15 minutes.)",
  locked: "Too many attempts. Wait 15 minutes, then try again.",
  disabled: "This account has been switched off. Ask whoever runs this Jiggered to turn it back on.",
  busy: "Lots of people are signing in at once. Try again in a moment."
}[e];
if (msg) document.getElementById("err").textContent = msg;
