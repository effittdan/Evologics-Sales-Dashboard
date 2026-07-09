const approvedEmails = new Set([
  "theresa@evologicsamerica.com",
  "dan@effitt.com",
  "mike@evologicsamerica.com",
  "ryan@evologicsamerica.com",
  "jim@evologicsamerica.com",
  "sam@evologicsamerica.com"
]);

const handler = async (event) => {
  const payload = JSON.parse(event.body || "{}");
  const email = String(payload.user?.email || "").toLowerCase();

  if (!approvedEmails.has(email)) {
    return {
      statusCode: 403,
      body: JSON.stringify({ message: "This email is not approved for the Evologics dashboard." })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({})
  };
};

exports.handler = handler;
