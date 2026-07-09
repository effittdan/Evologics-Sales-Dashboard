const approvedUsers = {
  "theresa@evologicsamerica.com": { name: "Theresa Hong", roles: ["administrator"] },
  "dan@effitt.com": { name: "Dan Hong", roles: ["administrator"] },
  "mike@evologicsamerica.com": { name: "Mike Crescenzo", roles: ["user"] },
  "ryan@evologicsamerica.com": { name: "Ryan Gray", roles: ["user"] },
  "jim@evologicsamerica.com": { name: "Jim Courville", roles: ["user"] },
  "sam@evologicsamerica.com": { name: "Sam Williamson", roles: ["user"] }
};

const handler = async (event) => {
  const payload = JSON.parse(event.body || "{}");
  const email = String(payload.user?.email || "").toLowerCase();
  const approvedUser = approvedUsers[email];

  if (!approvedUser) {
    return {
      statusCode: 403,
      body: JSON.stringify({ message: "This email is not approved for the Evologics dashboard." })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      app_metadata: {
        ...payload.user?.app_metadata,
        roles: approvedUser.roles
      },
      user_metadata: {
        ...payload.user?.user_metadata,
        full_name: approvedUser.name
      }
    })
  };
};

exports.handler = handler;
