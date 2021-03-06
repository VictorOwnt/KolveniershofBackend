var express = require('express');
var router = express.Router();
let mongoose = require('mongoose');
var array = require('lodash/array');
let Bus = mongoose.model("Bus");
let BusUnit = mongoose.model("BusUnit");
let Workday = mongoose.model("Workday");
let WorkdayTemplate = mongoose.model("WorkdayTemplate");
let jwt = require('express-jwt');

let auth = jwt({ secret: process.env.KOLV02_BACKEND_SECRET });

/* GET busses */
router.get('/', auth, function(req, res, next) {
    let query = Bus.find();
    query.exec(function(err, busses) {
        if (err) return next(err);
        res.json(busses);
    });
});

/* GET bus by id */
router.param("busId", function (req, res, next, id) {
    let query = Bus.findById(id);
    query.exec(function (err, bus) {
        if (err) return next(err);
        if (!bus) return next(new Error("not found " + id));
        req.bus = bus;
        return next();
    });
});
router.get("/id/:busId", auth, function (req, res, next) {
    res.json(req.bus);
});

/* POST bus */
router.post("/", auth, function (req, res, next) {
    // Check permissions
    if (!req.user.admin) return res.status(401).end();

    let bus = new Bus({
        name: req.body.name,
        color: req.body.color
    });
    bus.save(function (err, bus) {
        if (err) return next(err);
        res.json(bus);
    });
});

/* DELETE bus */
router.delete("/id/:busId", auth, function (req, res, next) {
    // Check permissions
    if (!req.user.admin) return res.status(401).end();

    req.bus.remove(function (err) {
        if (err) return next(err);
        res.send(true);
    });
});

/* PATCH bus */
router.patch("/id/:busId", auth, function (req, res, next) {
    // Check permissions
    if (!req.user.admin) return res.status(401).end();

    let bus = req.bus;
    if (req.body.name)
        bus.name = req.body.name;
    if (req.body.color)
        bus.color = req.body.color;
    bus.save(function (err, bus) {
        if (err) return next(err);
        res.json(bus);
    });
});

/* GET busUnits */
router.get("/units/", auth, function(req, res, next) {
    let query = BusUnit.find()
        .populate(['bus', { path: 'mentors', select: '-salt -hash' }, { path: 'clients', select: '-salt -hash' }]);
    query.exec(function(err, busUnits) {
        if (err) return next(err);
        res.json(busUnits);
    });
});

/* GET busUnit by id */
router.param("busUnitId", function (req, res, next, id) {
    let query = BusUnit.findById(id)
        .populate(['bus', { path: 'mentors', select: '-salt -hash' }, { path: 'clients', select: '-salt -hash' }]);
    query.exec(function (err, busUnit) {
        if (err) return next(err);
        if (!busUnit) return next(new Error("not found " + id));
        req.busUnit = busUnit;
        return next();
    });
});
router.get("/units/id/:busUnitId", auth, function (req, res, next) {
    res.json(req.busUnit);
});

/* POST busUnit */
router.post("/units/", auth, function (req, res, next) {
    // Check permissions
    if (!req.user.admin) return res.status(401).end();

    let busUnit = new BusUnit({
        bus: req.body.bus,
        mentors: req.body.mentors,
        clients: req.body.clients
    });
    busUnit.save(function (err, busUnit) {
        if (err) return next(err);
        res.json(busUnit);
    });
});

/* DELETE busUnit */
router.delete("/units/id/:busUnitId/force", auth, function (req, res, next) {
    // Check permissions
    if (!req.user.admin) return res.status(401).end();

    deleteUnit(req, res, next, req.busUnit, false);

});

/* DELETE busUnit from workday/workdayTemplate */
router.delete("/units/id/:busUnitId", auth, async function (req, res, next) {
    // Check permissions
    if (!req.user.admin) return res.status(401).end();

    // Check if all required fields are filled in
    if (!req.body.workdayId && !req.body.workdayTemplateId)
        return res.status(400).send("Gelieve alle velden in te vullen."); // TODO - i18n

    // Find all elements with usages
    let workdaysWithUsage = await Workday.find({
        $or: [{ morningBusses: req.busUnit }, { eveningBusses: req.busUnit }]
    }).lean();
    let workdayTemplatesWithUsage = await WorkdayTemplate.find({
        $or: [{ morningBusses: req.busUnit }, { eveningBusses: req.busUnit }]
    }).lean();

    // Delete unit from workday/workdayTemplate
    if (req.body.workdayId) {
        Workday.findById(req.body.workdayId, (err, workday) => {
            if (err) return next(err);
            if (!workday) return next(new Error("No workday found"));
            array.remove(workday.morningBusses, function(busUnit) {
                return busUnit._id.toString() === req.busUnit._id.toString();
            });
            array.remove(workday.eveningBusses, function(busUnit) {
                return busUnit._id.toString() === req.busUnit._id.toString();
            });
            workday.markModified("morningBusses");
            workday.markModified("eveningBusses");
            workday.save().then(updatedWorkday => {
                array.remove(workdaysWithUsage, function (workdayDel) {
                    return workdayDel._id.toString() === updatedWorkday._id.toString();
                });
                // Delete based on more than one usage
                deleteUnit(req, res, next, req.busUnit, (workdaysWithUsage.length + workdayTemplatesWithUsage.length) >= 1)
            });
        });
    } else if (req.body.workdayTemplateId) {
        WorkdayTemplate.findById(req.body.workdayTemplateId, (err, workdayTemplate) => {
            if (err) return next(err);
            if (!workdayTemplate) return next(new Error("No workdayTemplate found"));
            array.remove(workdayTemplate.morningBusses, function(busUnit) {
                return busUnit._id.toString() === req.busUnit._id.toString();
            });
            array.remove(workdayTemplate.eveningBusses, function(busUnit) {
                return busUnit._id.toString() === req.busUnit._id.toString();
            });
            workdayTemplate.markModified("morningBusses");
            workdayTemplate.markModified("eveningBusses");
            workdayTemplate.save().then(function (updatedWorkdayTemplate) {
                array.remove(workdayTemplatesWithUsage, function (workdayTemplateDel) {
                    return workdayTemplateDel._id.toString() === updatedWorkdayTemplate._id.toString()
                });
                // Delete based on more than one usage
                deleteUnit(req, res, next, req.busUnit, (workdaysWithUsage.length + workdayTemplatesWithUsage.length) >= 1);
            });
        });
    }
});

/* PATCH busUnit */
router.patch("/units/id/:busUnitId/force", auth, function (req, res, next) {
    // Check permissions
    if (!req.user.admin) return res.status(401).end();

    patchUnit(req, res, next, req.busUnit, false)
});

/* PATCH busUnit from (within) workday/workdayTemplate */
router.patch("/units/id/:busUnitId", auth, async function (req, res, next) {
    // Check permissions
    if (!req.user.admin) return res.status(401).end();

    // Check if all required fields are filled in
    if (!req.body.workdayId && !req.body.workdayTemplateId)
        return res.status(400).send("Gelieve alle velden in te vullen."); // TODO - i18n

    // Find all elements with usages
    let workdaysWithUsage = await Workday.find({
        $or: [{ morningBusses: req.busUnit }, { eveningBusses: req.busUnit }]
    }).lean();
    let workdayTemplatesWithUsage = await WorkdayTemplate.find({
        $or: [{ morningBusses: req.busUnit }, { eveningBusses: req.busUnit }]
    }).lean();

    // Check if has usages
    const hasUsages = (workdaysWithUsage.length + workdayTemplatesWithUsage.length) > 1;
    // Patch unit, return unit if new one is made
    let patchedUnit = patchUnit(req, res, next, req.busUnit, hasUsages);

    if (hasUsages) {
        // Replace unit in workday
        if (req.body.workdayId) {
            await Workday.findById(req.body.workdayId, (err, workday) => {
                if (err) return next(err);
                if (!workday) return next(new Error("No workday found"));
                // Find index for unit
                let amIndex = array.findIndex(workday.morningBusses, req.busUnit._id);
                let pmIndex = array.findIndex(workday.eveningBusses, req.busUnit._id);
                // Replace unit
                if (amIndex !== -1) {
                    workday.morningBusses.splice(amIndex, 1, patchedUnit);
                    workday.markModified("morningBusses");
                }
                if (pmIndex !== -1) {
                    workday.eveningBusses.splice(pmIndex, 1, patchedUnit);
                    workday.markModified("eveningBusses");
                }
                // Save unit
                patchedUnit.save(function (err, busUnit) {
                    if (err) return next(err);
                    // Save workday
                    workday.save(function (err) {
                        if (err) return next(err);
                        res.json(busUnit);
                    });
                });
            });
        } else if (req.body.workdayTemplateId) {
            await WorkdayTemplate.findById(req.body.workdayTemplateId, (err, workdayTemplate) => {
                if (err) return next(err);
                if (!workdayTemplate) return next(new Error("No workday template found"));
                // Find index for unit
                let amIndex = array.findIndex(workdayTemplate.morningBusses, req.busUnit._id);
                let pmIndex = array.findIndex(workdayTemplate.eveningBusses, req.busUnit._id);
                // Replace unit
                if (amIndex !== -1) {
                    workdayTemplate.morningBusses.splice(amIndex, 1, patchedUnit);
                    workdayTemplate.markModified("morningBusses");
                }
                if (pmIndex !== -1) {
                    workdayTemplate.eveningBusses.splice(pmIndex, 1, patchedUnit);
                    workdayTemplate.markModified("eveningBusses");
                }
                // Save unit
                patchedUnit.save(function (err, busUnit) {
                    if (err) return next(err);
                    // Save workdayTemplate
                    workdayTemplate.save(function (err) {
                        if (err) return next(err);
                        res.json(busUnit);
                    });
                });
            });
        }
    } else {
        await patchedUnit.save(function (err, busUnit) {
            if (err) return next(err);
            res.json(busUnit);
        });
    }
});

// Delete unit
function deleteUnit(req, res, next, unit, hasUsages) {
    if (!hasUsages) {
        unit.remove(function (err) {
            if (err) return next(err);
            res.send(true);
        });
    } else {
        res.send(true);
    }
}

// Patch unit
function patchUnit(req, res, next, unit, hasUsages) {
    if (hasUsages) {
        return new BusUnit({
            bus: req.body.bus ? req.body.bus : unit.bus,
            mentors: req.body.mentors ? req.body.mentors : unit.mentors,
            clients: req.body.clients ? req.body.clients : unit.clients
        });
    } else {
        if (req.body.bus) {
            unit.bus = req.body.bus;
            unit.markModified("bus");
        }
        if (req.body.mentors) {
            unit.mentors = req.body.mentors;
            unit.markModified("mentors");
        }
        if (req.body.clients) {
            unit.clients = req.body.clients;
            unit.markModified("clients");
        }
        return unit;
    }
}

module.exports = router;
