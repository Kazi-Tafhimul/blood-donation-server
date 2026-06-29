const dns = require("node:dns/promises");
dns.setServers(["1.1.1.1", "8.8.8.8"]);
const express = require("express");
const cors = require("cors");
const app = express();
const port = 5000;

require("dotenv").config();
app.use(cors());
app.use(express.json());
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
app.get("/", (req, res) => {
  res.send("hello world");
});

const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const database = client.db("bloodlink_new");
    const requestCollection = database.collection("requests");
    const fundingCollection = database.collection("fundings");
    app.post("/api/fundings", async (req, res) => {
      try {
        const fundingLog = req.body;

        if (!fundingLog.transactionId || !fundingLog.amount) {
          return res.status(400).json({
            success: false,
            message: "Missing required funding details",
          });
        }

        const result = await fundingCollection.insertOne(fundingLog);
        res.status(201).json({ success: true, insertedId: result.insertedId });
      } catch (error) {
        console.error("Error saving funding log:", error);
        res.status(500).json({
          success: false,
          message: "Internal server error saving payment log",
        });
      }
    });
    app.get("/api/fundings", async (req, res) => {
      try {
        const history = await fundingCollection
          .find()
          .sort({ date: -1 })
          .toArray();
        res.status(200).json(history);
      } catch (error) {
        console.error("Error fetching funding records:", error);
        res.status(500).json({
          success: false,
          message: "Failed to load payment history matrix",
        });
      }
    });
    app.post("/api/requests", async (req, res) => {
      const request = req.body;
      const result = await requestCollection.insertOne(request);
      res.send(result);
    });
    app.get("/api/requests", async (req, res) => {
      try {
        const { email, status, page, limit } = req.query;
        let matchQuery = {};

        if (email) {
          matchQuery.requesterEmail = email;
        }

        if (status && status !== "all") {
          if (status === "pending") {
            matchQuery.$or = [
              { status: { $regex: "^pending$", $options: "i" } },
              { status: { $exists: false } },
              { status: null },
            ];
          } else if (status === "inprogress") {
            matchQuery.status = { $regex: "^in\\s*progress$", $options: "i" };
          } else {
            matchQuery.status = { $regex: `^${status}$`, $options: "i" };
          }
        }

        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 6;
        const skipNum = (pageNum - 1) * limitNum;

        const requests = await requestCollection
          .find(matchQuery)
          .sort({ _id: -1 })
          .skip(skipNum)
          .limit(limitNum)
          .toArray();

        res.status(200).json(requests);
      } catch (error) {
        console.error("Fetch error details:", error);
        res.status(500).json([]);
      }
    });
    app.delete("/api/requests/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid Request ID format" });
        }

        const query = { _id: new ObjectId(id) };
        const result = await requestCollection.deleteOne(query);

        if (result.deletedCount === 1) {
          res
            .status(200)
            .json({ success: true, message: "Deleted successfully" });
        } else {
          res
            .status(404)
            .json({ success: false, message: "Request not found" });
        }
      } catch (error) {
        console.error("Delete error details:", error);
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    });
    app.get("/api/admin/stats", async (req, res) => {
      try {
        const totalDonors = await client
          .db("bloodlink_new")
          .collection("user")
          .countDocuments();

        const totalRequests = await client
          .db("bloodlink_new")
          .collection("requests")
          .countDocuments();

        let totalFunding = 0;
        try {
          const fundingCollection = client
            .db("bloodlink_new")
            .collection("fundings");
          const fundingData = await fundingCollection.find({}).toArray();
          totalFunding = fundingData.reduce(
            (sum, doc) => sum + (Number(doc.amount) || 0),
            0,
          );
        } catch (e) {
          totalFunding = 0;
        }

        res.status(200).json({
          totalDonors,
          totalRequests,
          totalFunding,
        });
      } catch (error) {
        console.error("Admin stats fetch error:", error);
        res
          .status(500)
          .json({ totalDonors: 0, totalRequests: 0, totalFunding: 0 });
      }
    });
    app.patch("/api/requests/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid Request ID format" });
        }

        if (!status) {
          return res.status(400).json({ message: "Status value is required" });
        }

        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: { status: status },
        };

        const result = await requestCollection.updateOne(query, updateDoc);

        if (result.matchedCount === 1) {
          res
            .status(200)
            .json({ success: true, message: "Status updated successfully" });
        } else {
          res
            .status(404)
            .json({ success: false, message: "Request not found" });
        }
      } catch (error) {
        console.error("Update status error details:", error);
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    });

    app.get("/api/users", async (req, res) => {
      try {
        const { status } = req.query;
        let matchQuery = {};

        if (status && status !== "all") {
          matchQuery.status = status;
        }

        const users = await client
          .db("bloodlink_new")
          .collection("user")
          .find(matchQuery)
          .toArray();
        res.status(200).json(users);
      } catch (error) {
        console.error("Fetch users error:", error);
        res.status(500).json([]);
      }
    });

    app.patch("/api/users/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { status, role } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid User ID format" });
        }

        let updateDoc = { $set: {} };
        if (status) updateDoc.$set.status = status;
        if (role) updateDoc.$set.role = role;

        const result = await client
          .db("bloodlink_new")
          .collection("user")
          .updateOne({ _id: new ObjectId(id) }, updateDoc);

        if (result.matchedCount === 1) {
          res
            .status(200)
            .json({ success: true, message: "User updated successfully" });
        } else {
          res.status(404).json({ success: false, message: "User not found" });
        }
      } catch (error) {
        console.error("Update user error:", error);
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    });
    app.get("/api/requests/:id", async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid ID format" });
        }
        const result = await requestCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!result) {
          return res.status(404).json({ message: "Request not found" });
        }
        res.status(200).json(result);
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    });

    app.put("/api/requests/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updateData = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid Request ID format" });
        }

        delete updateData._id;

        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: updateData,
        };

        const result = await requestCollection.updateOne(query, updateDoc);

        if (result.matchedCount === 1) {
          res.status(200).json({
            success: true,
            message: "Blood request details updated successfully",
          });
        } else {
          res
            .status(404)
            .json({ success: false, message: "Request not found" });
        }
      } catch (error) {
        console.error("Update form details error:", error);
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    });
 app.get("/api/donors/search", async (req, res) => {
  try {
    const { bloodGroup, district, upazila } = req.query;
    const query = {};
    const totalUsersInDb = await client
      .db("bloodlink_new")
      .collection("user")
      .countDocuments({});
      
   

    
    query.role = { $regex: "^donor$", $options: "i" };

  
    if (bloodGroup && bloodGroup !== "undefined" && bloodGroup.trim() !== "") {
      query.bloodGroup = bloodGroup.trim(); 
    }

   
    if (district && district !== "undefined" && district.trim() !== "") {
      query.district = { $regex: `^${district.trim()}$`, $options: "i" };
    }

    
    if (upazila && upazila !== "undefined" && upazila.trim() !== "") {
      query.upazila = { $regex: `^${upazila.trim()}$`, $options: "i" };
    }

    console.log("Constructed MongoDB Query Object:", JSON.stringify(query, null, 2));

    const donors = await client
      .db("bloodlink_new")
      .collection("user")
      .find(query)
      .toArray();

    console.log(`Found ${donors.length} matching donors in database.`);
    res.status(200).json(donors);
  } catch (error) {
    console.error("Backend donor search database query failure:", error);
    res.status(500).json({ error: "Failed to query donor data records" });
  }
});
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    //await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log("app listening on port ${port}");
});
