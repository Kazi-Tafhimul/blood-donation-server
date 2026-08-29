const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
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
  // console.log("AUTH HEADER:", authHeader);

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
    console.log("REQ.USER ID:", req.user.id);

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
    const userCollection = db.collection("user");
    const donationRequestCollection = db.collection("donationRequests");

    await client.db("admin").command({ ping: 1 });

    console.log("MongoDB connected successfully!");
    app.post(
      "/donation-requests",
      verifyToken,
      requireRole("donor", "admin"),
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
      requireRole("donor", "admin"),
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
                status: "inprogress",
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
      requireRole("donor", "admin"),
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
      requireRole("donor", "admin"),
      async (req, res) => {
        try {
          const { id } = req.params;

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              message: "Invalid donation request ID",
            });
          }

          const existingRequest = await donationRequestCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!existingRequest) {
            return res.status(404).json({
              message: "Donation request not found",
            });
          }

          // Donor can edit only own request.
          // Admin can edit any request.
          if (
            req.user.role !== "admin" &&
            existingRequest.requesterId !== req.user.id
          ) {
            return res.status(403).json({
              message: "You can only edit your own donation request",
            });
          }

          // Completed/canceled requests cannot be edited.
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

          // IMPORTANT:
          // Admin -> search only by _id
          // Donor -> search by _id + requesterId
          const updateFilter =
            req.user.role === "admin"
              ? {
                  _id: new ObjectId(id),
                }
              : {
                  _id: new ObjectId(id),
                  requesterId: req.user.id,
                };

          const updatedRequest =
            await donationRequestCollection.findOneAndUpdate(
              updateFilter,
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
      requireRole("donor", "admin"),
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

          const existingRequest = await donationRequestCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!existingRequest) {
            return res.status(404).json({
              message: "Donation request not found",
            });
          }

          // Donor can update only own request.
          // Admin can update any request.
          if (
            req.user.role !== "admin" &&
            existingRequest.requesterId !== req.user.id
          ) {
            return res.status(403).json({
              message: "You can only update your own donation request",
            });
          }

          // Status can only change from in-progress.
          if (existingRequest.status !== "inprogress") {
            return res.status(400).json({
              message:
                "Donation status can only be changed when it is in-progress",
            });
          }

          // IMPORTANT:
          // Admin -> search only by _id
          // Donor -> search by _id + requesterId
          const updateFilter =
            req.user.role === "admin"
              ? {
                  _id: new ObjectId(id),
                  status: "inprogress",
                }
              : {
                  _id: new ObjectId(id),
                  requesterId: req.user.id,
                  status: "inprogress",
                };

          const updatedRequest =
            await donationRequestCollection.findOneAndUpdate(
              updateFilter,
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
      requireRole("donor", "admin"),
      async (req, res) => {
        try {
          const { id } = req.params;

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              message: "Invalid donation request ID",
            });
          }

          const existingRequest = await donationRequestCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!existingRequest) {
            return res.status(404).json({
              message: "Donation request not found",
            });
          }

          if (
            req.user.role !== "admin" &&
            existingRequest.requesterId !== req.user.id
          ) {
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

          const deleteFilter =
            req.user.role === "admin"
              ? {
                  _id: new ObjectId(id),
                }
              : {
                  _id: new ObjectId(id),
                  requesterId: req.user.id,
                };

          const result =
            await donationRequestCollection.deleteOne(deleteFilter);

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
    // console.log("PROFILE ROUTE REGISTERED");
    app.get("/profile", verifyToken, async (req, res) => {
      try {
        const user = await userCollection.findOne(
          {
            _id: new ObjectId(req.user.id),
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
    });
    app.patch("/profile", verifyToken, async (req, res) => {
      try {
        const { name, bloodGroup, district, upazila, image, photo } = req.body;

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
            _id: new ObjectId(req.user.id),
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
    });
    app.get(
      "/dashboard/stats",
      verifyToken,
      requireRole("admin", "volunteer"),
      async (req, res) => {
        try {
          const totalDonors = await userCollection.countDocuments({
            role: "donor",
          });

          const totalFunding = 0;

          const totalRequests = await donationRequestCollection.countDocuments(
            {},
          );

          res.status(200).json({
            totalDonors,
            totalFunding,
            totalRequests,
          });
        } catch (error) {
          console.error("Get dashboard stats failed:", error);

          res.status(500).json({
            message: "Failed to fetch dashboard statistics",
          });
        }
      },
    );
    app.get(
      "/admin/donation-requests",
      verifyToken,
      requireRole("admin"),
      async (req, res) => {
        try {
          const donationRequests = await donationRequestCollection
            .find({})
            .sort({ createdAt: -1 })
            .toArray();

          res.status(200).json(donationRequests);
        } catch (error) {
          console.error("Get all donation requests failed:", error);

          res.status(500).json({
            message: "Failed to fetch all donation requests",
          });
        }
      },
    );
    app.get(
      "/admin/users",
      verifyToken,
      requireRole("admin"),
      async (req, res) => {
        try {
          const page = parseInt(req.query.page) || 1;
          const limit = parseInt(req.query.limit) || 10;
          const status = req.query.status;

          const skip = (page - 1) * limit;

          // Filter
          const filter = {};

          if (status === "active" || status === "blocked") {
            filter.status = status;
          }

          // Total users
          const totalUsers = await userCollection.countDocuments(filter);

          // Users for current page
          const users = await userCollection
            .find(filter, {
              projection: {
                password: 0,
              },
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

          const totalPages = Math.ceil(totalUsers / limit);

          res.status(200).json({
            users,
            totalUsers,
            totalPages,
            currentPage: page,
          });
        } catch (error) {
          console.error("Get all users failed:", error);

          res.status(500).json({
            message: "Failed to fetch users",
          });
        }
      },
    );
    app.patch(
      "/admin/users/:id/status",
      verifyToken,
      requireRole("admin"),
      async (req, res) => {
        try {
          const { id } = req.params;
          const { status } = req.body;

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              message: "Invalid user ID",
            });
          }

          if (!["active", "blocked"].includes(status)) {
            return res.status(400).json({
              message: "Invalid status",
            });
          }

          const updatedUser = await userCollection.findOneAndUpdate(
            {
              _id: new ObjectId(id),
            },
            {
              $set: {
                status,
                updatedAt: new Date(),
              },
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
              message: "User not found",
            });
          }

          res.status(200).json({
            message: `User ${status === "blocked" ? "blocked" : "unblocked"} successfully`,
            user: updatedUser,
          });
        } catch (error) {
          console.error("Update user status failed:", error);

          res.status(500).json({
            message: "Failed to update user status",
          });
        }
      },
    );
    app.patch(
      "/admin/users/:id/role",
      verifyToken,
      requireRole("admin"),
      async (req, res) => {
        try {
          const { id } = req.params;
          const { role } = req.body;

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              message: "Invalid user ID",
            });
          }

          if (!["donor", "volunteer", "admin"].includes(role)) {
            return res.status(400).json({
              message: "Invalid role",
            });
          }

          const updatedUser = await userCollection.findOneAndUpdate(
            {
              _id: new ObjectId(id),
            },
            {
              $set: {
                role,
                updatedAt: new Date(),
              },
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
              message: "User not found",
            });
          }

          res.status(200).json({
            message: `User role updated to ${role}`,
            user: updatedUser,
          });
        } catch (error) {
          console.error("Update user role failed:", error);

          res.status(500).json({
            message: "Failed to update user role",
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
