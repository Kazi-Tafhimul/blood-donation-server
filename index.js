const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  }),
);

app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);

    req.user = payload;

    next();
  } catch (error) {
    console.error("JWT verification failed:", error);

    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
};
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user?.role) {
      return res.status(403).json({
        message: "Forbidden",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: "Forbidden",
      });
    }

    next();
  };
};

async function run() {
  try {
    await client.connect();
    const db = client.db("blood-donation-db");
    const userCollection = db.collection("users");
    const donationRequestCollection = db.collection("donationRequests");

    await client.db("admin").command({ ping: 1 });

    console.log("MongoDB connected successfully!");
    app.post(
      "/donation-requests",
      verifyToken,
      requireRole("donor"),
      async (req, res) => {
        try {
          const {
            recipientName,
            bloodGroup,
            district,
            upazila,
            hospitalName,
            fullAddress,
            donationDate,
            donationTime,
            requestMessage,
          } = req.body;

          if (
            !recipientName ||
            !bloodGroup ||
            !district ||
            !upazila ||
            !hospitalName ||
            !fullAddress ||
            !donationDate ||
            !donationTime ||
            !requestMessage
          ) {
            return res.status(400).json({
              message: "All fields are required",
            });
          }

          const donationRequest = {
            requesterId: req.user.id,
            requesterName: req.user.name,
            requesterEmail: req.user.email,

            recipientName,
            bloodGroup,
            district,
            upazila,
            hospitalName,
            fullAddress,
            donationDate,
            donationTime,
            requestMessage,

            status: "pending",

            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const result =
            await donationRequestCollection.insertOne(donationRequest);

          res.status(201).json({
            message: "Donation request created successfully",
            insertedId: result.insertedId,
          });
        } catch (error) {
          console.error("Create donation request failed:", error);

          res.status(500).json({
            message: "Failed to create donation request",
          });
        }
      },
    );
    app.get("/donation-requests", async (req, res) => {
      try {
        const donationRequests = await donationRequestCollection
          .find({
            status: "pending",
          })
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).json(donationRequests);
      } catch (error) {
        console.error("Get donation requests failed:", error);

        res.status(500).json({
          message: "Failed to fetch donation requests",
        });
      }
    });

    app.get("/", (req, res) => {
      res.send("Blood Donation Server is running!");
    });

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("MongoDB connection failed:", error);
  }
}

run();
