const months = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const days = ["sun", "mon", "tue", "wed", "thur", "fri", "sat"];

for (let i = 0; i < 7; i++) {
  const day = document.createElement("div");
  day.innerText = days[i];
  document.getElementById("day-grid").appendChild(day);
}

function lerp(v0, v1, t) {
  return v0 * (1 - t) + v1 * t;
}

const getDayColor = (yearProgress) => {
  const yearOffset = 120;
  return `hsl(${lerp(
    360 - yearOffset,
    720 - yearOffset,
    yearProgress
  )}deg, 100%, 50%)`;
};

const render = (date) => {
  // reset
  document.getElementById("cal-grid").innerHTML = "";

  const today = new Date(date);
  const month = today.getMonth();
  const year = today.getFullYear();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInMonthLast = new Date(year, month, 0).getDate();

  document.getElementById("header").innerText = `${months[month]} ${year}`;

  const yearProgress = month / 12;
  const bgColor = getDayColor(yearProgress);
  document.documentElement.style.setProperty("--month-color", bgColor);

  let dayNum = 0;
  for (let i = 0; i < 42; i++) {
    const calDay = document.createElement("div");
    calDay.classList.add("cal-day");
    document.getElementById("cal-grid").appendChild(calDay);

    console.log({ daysInMonthLast, firstDay, i });

    // prev days
    const day = document.createElement("div");
    if (i < firstDay) {
      day.innerText = daysInMonthLast - (firstDay - i) + 1;
      calDay.classList.add("other-month");
    }
    // most days
    if (i >= firstDay && dayNum < daysInMonth) {
      dayNum += 1;
      day.innerText = dayNum;
      calDay.appendChild(day);
    }
    // remaining days
    else if (i >= firstDay + daysInMonth) {
      day.innerText = 1 + (i - (firstDay + daysInMonth));
      calDay.classList.add("other-month");
    }

    calDay.appendChild(day);
  }
};

render(new Date());

let renderedDate = new Date();

document.addEventListener("keydown", (e) => {
  const month = renderedDate.getMonth();
  const year = renderedDate.getFullYear();
  if (e.key === "ArrowRight") {
    renderedDate = new Date(year, month + 1);
  }
  if (e.key === "ArrowLeft") {
    renderedDate = new Date(year, month - 1);
  }
  render(renderedDate);
});
