const e = new URLSearchParams(location.search).get("e");
const msg = {
  bad: "That username or password didn't match. Try again.",
  locked: "Too many attempts. Wait 15 minutes, then try again."
}[e];
if (msg) document.getElementById("err").textContent = msg;
