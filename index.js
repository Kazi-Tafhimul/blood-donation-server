const express = require("express");
const cors = require("cors");
require("dotenv").config();
const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
} = require("mongodb");
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
    app.get("/donation-requests/:id", async (req, res) => {
      try {
        const { ObjectId } = require("mongodb");

        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({
            message: "Invalid donation request ID",
          });
        }

        const donationRequest = await donationRequestCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!donationRequest) {
          return res.status(404).json({
            message: "Donation request not found",
          });
        }

        res.status(200).json(donationRequest);
      } catch (error) {
        console.error("Get donation request details failed:", error);

        res.status(500).json({
          message: "Failed to fetch donation request",
        });
      }
    });

    app.patch(
      "/donation-requests/:id/donate",
      verifyToken,
      requireRole("donor"),
      async (req, res) => {
        try {
          const { ObjectId } = require("mongodb");

          const { id } = req.params;

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              message: "Invalid donation request ID",
            });
          }

          const donationRequest = await donationRequestCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!donationRequest) {
            return res.status(404).json({
              message: "Donation request not found",
            });
          }

          if (donationRequest.status !== "pending") {
            return res.status(400).json({
              message: "This donation request is no longer available",
            });
          }

          const donor = {
            donorId: req.user.id,
            donorName: req.user.name,
            donorEmail: req.user.email,
          };

          const result = await donationRequestCollection.findOneAndUpdate(
            {
              _id: new ObjectId(id),
              status: "pending",
            },
            {
              $set: {
                status: "in-progress",
                donorId: donor.donorId,
                donorName: donor.donorName,
                donorEmail: donor.donorEmail,
                updatedAt: new Date(),
              },
            },
            {
              returnDocument: "after",
            },
          );

          if (!result) {
            return res.status(409).json({
              message: "This donation request has already been accepted",
            });
          }

          res.status(200).json({
            message: "Donation confirmed successfully",
            donationRequest: result,
          });
        } catch (error) {
          console.error("Confirm donation failed:", error);

          res.status(500).json({
            message: "Failed to confirm donation",
          });
        }
      },
    );
    app.get(
      "/my-donation-requests",
      verifyToken,
      requireRole("donor"),
      async (req, res) => {
        try {
          const donationRequests = await donationRequestCollection
            .find({
              requesterId: req.user.id,
            })
            .sort({ createdAt: -1 })
            .toArray();

          res.status(200).json(donationRequests);
        } catch (error) {
          console.error("Get my donation requests failed:", error);

          res.status(500).json({
            message: "Failed to fetch your donation requests",
          });
        }
      },
    );
     app.patch(
      "/donation-requests/:id",
      verifyToken,
      requireRole("donor"),
      async (req, res) => {
        try {
          const { id } = req.params;

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              message: "Invalid donation request ID",
            });
          }

          const existingRequest =
            await donationRequestCollection.findOne({
              _id: new ObjectId(id),
            });

          if (!existingRequest) {
            return res.status(404).json({
              message: "Donation request not found",
            });
          }

          // Only request owner can edit
          if (existingRequest.requesterId !== req.user.id) {
            return res.status(403).json({
              message: "You can only edit your own donation request",
            });
          }

          // Do not allow editing completed/canceled requests
          if (
            existingRequest.status === "done" ||
            existingRequest.status === "canceled"
          ) {
            return res.status(400).json({
              message: "Completed or canceled requests cannot be edited",
            });
          }

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

          // Validate required fields
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

          const updatedRequest =
            await donationRequestCollection.findOneAndUpdate(
              {
                _id: new ObjectId(id),
                requesterId: req.user.id,
              },
              {
                $set: {
                  recipientName,
                  bloodGroup,
                  district,
                  upazila,
                  hospitalName,
                  fullAddress,
                  donationDate,
                  donationTime,
                  requestMessage,
                  updatedAt: new Date(),
                },
              },
              {
                returnDocument: "after",
              },
            );

          if (!updatedRequest) {
            return res.status(404).json({
              message: "Donation request not found",
            });
          }

          res.status(200).json({
            message: "Donation request updated successfully",
            donationRequest: updatedRequest,
          });
        } catch (error) {
          console.error("Update donation request failed:", error);

          res.status(500).json({
            message: "Failed to update donation request",
          });
        }
      },
    );
     app.patch(
      "/donation-requests/:id/status",
      verifyToken,
      requireRole("donor"),
      async (req, res) => {
        try {
          const { id } = req.params;
          const { status } = req.body;

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              message: "Invalid donation request ID",
            });
          }

          const allowedStatuses = ["done", "canceled"];

          if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
              message: "Invalid status. Allowed values are done or canceled",
            });
          }

          const existingRequest =
            await donationRequestCollection.findOne({
              _id: new ObjectId(id),
            });

          if (!existingRequest) {
            return res.status(404).json({
              message: "Donation request not found",
            });
          }

          // Only request owner can change status
          if (existingRequest.requesterId !== req.user.id) {
            return res.status(403).json({
              message: "You can only update your own donation request",
            });
          }

          // Status can only change from in-progress
          if (existingRequest.status !== "in-progress") {
            return res.status(400).json({
              message:
                "Donation status can only be changed when it is in-progress",
            });
          }

          const updatedRequest =
            await donationRequestCollection.findOneAndUpdate(
              {
                _id: new ObjectId(id),
                requesterId: req.user.id,
                status: "in-progress",
              },
              {
                $set: {
                  status,
                  updatedAt: new Date(),
                },
              },
              {
                returnDocument: "after",
              },
            );

          if (!updatedRequest) {
            return res.status(409).json({
              message: "Donation request status could not be updated",
            });
          }

          res.status(200).json({
            message: `Donation request marked as ${status}`,
            donationRequest: updatedRequest,
          });
        } catch (error) {
          console.error("Update donation status failed:", error);

          res.status(500).json({
            message: "Failed to update donation request status",
          });
        }
      },
    );
    app.delete(
      "/donation-requests/:id",
      verifyToken,
      requireRole("donor"),
      async (req, res) => {
        try {
          const { id } = req.params;

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              message: "Invalid donation request ID",
            });
          }

          const existingRequest =
            await donationRequestCollection.findOne({
              _id: new ObjectId(id),
            });

          if (!existingRequest) {
            return res.status(404).json({
              message: "Donation request not found",
            });
          }

          // Only request owner can delete
          if (existingRequest.requesterId !== req.user.id) {
            return res.status(403).json({
              message: "You can only delete your own donation request",
            });
          }

          // Prevent deleting completed/canceled requests
          if (
            existingRequest.status === "done" ||
            existingRequest.status === "canceled"
          ) {
            return res.status(400).json({
              message:
                "Completed or canceled donation requests cannot be deleted",
            });
          }

          const result =
            await donationRequestCollection.deleteOne({
              _id: new ObjectId(id),
              requesterId: req.user.id,
            });

          if (result.deletedCount === 0) {
            return res.status(404).json({
              message: "Donation request not found",
            });
          }

          res.status(200).json({
            message: "Donation request deleted successfully",
          });
        } catch (error) {
          console.error("Delete donation request failed:", error);

          res.status(500).json({
            message: "Failed to delete donation request",
          });
        }
      },
    );
     app.get(
      "/profile",
      verifyToken,
      async (req, res) => {
        try {
          const user = await userCollection.findOne(
            {
              _id: req.user.id,
            },
            {
              projection: {
                password: 0,
              },
            },
          );

          if (!user) {
            return res.status(404).json({
              message: "User profile not found",
            });
          }

          res.status(200).json(user);
        } catch (error) {
          console.error("Get profile failed:", error);

          res.status(500).json({
            message: "Failed to fetch profile",
          });
        }
      },
    );
     app.patch(
      "/profile",
      verifyToken,
      async (req, res) => {
        try {
          const {
            name,
            bloodGroup,
            district,
            upazila,
            image,
            photo,
          } = req.body;

          if (!name?.trim()) {
            return res.status(400).json({
              message: "Name is required",
            });
          }

          if (!bloodGroup) {
            return res.status(400).json({
              message: "Blood group is required",
            });
          }

          if (!district) {
            return res.status(400).json({
              message: "District is required",
            });
          }

          if (!upazila) {
            return res.status(400).json({
              message: "Upazila is required",
            });
          }

          const updateData = {
            name: name.trim(),
            bloodGroup,
            district,
            upazila,
            updatedAt: new Date(),
          };

          // Support either image or photo field
          if (image !== undefined) {
            updateData.image = image;
          } else if (photo !== undefined) {
            updateData.image = photo;
          }

          const updatedUser = await userCollection.findOneAndUpdate(
            {
              _id: req.user.id,
            },
            {
              $set: updateData,
            },
            {
              returnDocument: "after",
              projection: {
                password: 0,
              },
            },
          );

          if (!updatedUser) {
            return res.status(404).json({
              message: "User profile not found",
            });
          }

          res.status(200).json({
            message: "Profile updated successfully",
            user: updatedUser,
          });
        } catch (error) {
          console.error("Update profile failed:", error);

          res.status(500).json({
            message: "Failed to update profile",
          });
        }
      },
    );


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
