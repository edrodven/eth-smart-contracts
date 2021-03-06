const BigNumber = require('bignumber.js');
const { assertRevert } = require('./helpers/assertRevert');
var Crowdfund = artifacts.require("./Crowdfund.sol");
var Token = artifacts.require("./Token.sol");
const utils = require("./utils")

contract('Crowdfund', function (accounts) {

  function bigNumberize(num, decimals) {
    return new BigNumber(num).times(new BigNumber(10).pow(decimals));
  }

  async function jumpToTheFuture(seconds) {
    return web3
      .currentProvider
      .send({jsonrpc: "2.0", method: "evm_increaseTime", params: [seconds], id: 0});
  }

  async function getTimestampOfCurrentBlock() {
    return web3
      .eth
      .getBlock(web3.eth.blockNumber)
      .timestamp;
  }

  function isException(error) {
    let strError = error.toString();
    return strError.includes('invalid opcode') || strError.includes('invalid JUMP') || strError.includes("revert");
  }

  function ensureException(error) {
    assert(isException(error), error.toString());
  }

  const gasAmount = 6000000;
  const owner = accounts[0];
  const receivingAccount = accounts[1];
  const forwardAddress = accounts[7]
  const customer1 = accounts[2];
  const customer2 = accounts[3];
  const customer3 = accounts[4];
  const customer4 = accounts[5];
  const customer5 = accounts[6]
  const twentyEightDaysInSeconds = 2419200;
  const prices = [1000, 750, 500, 250]
  const epochs = [3, 4, 7, 14]
  const totalDays = 28
  const allocationAddresses = [
    forwardAddress,
    customer5,
    customer4,
    customer2,
    customer1,
    "0x0"
  ]
  const allocationBalances = [
    50000000000000000000000,
    100000000000000000000000,
    50000000000000000000000,
    200000000000000000000000,
    100000000000000000000000,
    500000000000000000000000
  ]
  const allocationTimelocks = [
    0,
    518400, // 6 months
    86400, // 1 months
    172800, // 2 months
    600, // 10 minutes
    0
  ]
  const totalSupply = 1000000000000000000000000
  const withCrowdfund = false;
  const crowdfundArgs = [
    owner,
    epochs,
    prices,
    receivingAccount,
    forwardAddress,
    totalDays,
    totalSupply,
    withCrowdfund,
    allocationAddresses,
    allocationBalances,
    allocationTimelocks
  ]

    it("BadConstructor Arguments", async() => {
        // Should fail if constructor arguments are not the right lengths
        let badArgs = [
            owner,
            epochs,
            prices,
            receivingAccount,
            forwardAddress,
            totalDays,
            totalSupply,
            withCrowdfund,
            allocationAddresses,
            allocationBalances,
            allocationTimelocks
        ];

        badArgs[1] = [3, 4, 7];
        await assertRevert(Crowdfund.new(...badArgs, {from: owner}))

        // Fix the bad arg, then introduce another bad arg
        badArgs[1] = epochs;
        badArgs[5] = 26;

        await assertRevert(Crowdfund.new(...badArgs, {from: owner}))

        // Fix the bad arg, then introduce another bad arg
        badArgs[1] = [0,0,0,0];
        badArgs[5] = 0;

        await assertRevert(Crowdfund.new(...badArgs, {from: owner}))
    });

  it("Init: The contract is initialized with the right variables", async() => {
    const crowdfund = await Crowdfund.new(...crowdfundArgs, {from: owner})
    const token = await Token.at(await crowdfund.token());

    const weiRaised = await crowdfund.weiRaised();
    const crowdfundFinalized = await crowdfund.crowdfundFinalized();
    const wallet = await crowdfund.wallet();
    const forwardTokensTo = await crowdfund.forwardTokensTo();
    const crowdfundLength = await crowdfund.crowdfundLength();
    const startsAt = await crowdfund
      .contract
      .startsAt();
    const endsAt = await crowdfund
      .contract
      .endsAt();
    const crowdfundOwner = await crowdfund.owner();
    const tokenOwner = await token.owner();
    const crowdfundAllocation = await token.allocations(crowdfund.address)
    const isActivated = await crowdfund.isActivated()

    let totalEpochs = 0
    for (var i = 0; i < epochs.length; i++) {
      let price = await crowdfund.rates(i)
      totalEpochs += epochs[i]
      assert.equal(price[0].eq(prices[i]), true, "Price at a certain epoch is right");
      assert.equal(price[1].eq(totalEpochs), true, "Passed in epochs are right");
    }

    assert.equal(weiRaised.eq(0), true, "The contract ether balance was not 5 ETH");
    assert.equal(isActivated, false, "The crowdfund is not activated");
    assert.equal(wallet, receivingAccount, "The receiving account should be the wallet");
    assert.equal(forwardTokensTo, forwardAddress, "The forward address should match");
    assert.equal(crowdfundLength.eq(twentyEightDaysInSeconds), true, "The crowdfund length should match");
    assert.equal(crowdfundOwner, owner, "Crowdfund Owner should match");
    assert.equal(tokenOwner, owner, "Token owner should match");
    assert.equal(startsAt.toNumber(), 0, "StartsAt should match");
    assert.equal(endsAt.toNumber(), 0, "EndsAt should match");
    assert.equal(crowdfundAllocation[0].eq(allocationBalances[allocationBalances.length - 1]), true, "Crowdfund Allocation balance is right");
    assert.equal(crowdfundAllocation[1].eq(allocationTimelocks[allocationBalances.length - 1]), true, "Crowdfund Allocation timelock is right");

  });

  it("Schedule and Reschedule crowdfund: It should schedule the crowdfund and not let " +
      "me reschedule after the crowdfund is active",
  async() => {
    const crowdfund = await Crowdfund.new(...crowdfundArgs, {from: owner})
    const token = await Token.at(await crowdfund.token());

    // First try to schedule the crowdfund in the past
    let errorSchedule = await getTimestampOfCurrentBlock() - 120
    try {
      await crowdfund.scheduleCrowdfund(errorSchedule)
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
    assert.equal((await crowdfund.startsAt()).eq(bigNumberize(0, 18)), true, "Should equal 0")
    assert.equal((await crowdfund.endsAt()).eq(bigNumberize(0, 18)), true, "Should equal 0")
    assert.equal((await token.crowdFundStartTime()).eq(bigNumberize(0, 0)), true, "Token should have the right start time")


    // Now schedule the crowdfund for 2 minutes in the futures
    let firstSchedule = await getTimestampOfCurrentBlock() + 1000 + 4*60*60

      // Should revert if start time is before current time
      try {
          await crowdfund.reScheduleCrowdfund(1);
          assert.equal(true,false,"Should fail");
      } catch (e) {
          ensureException(e)
      }

    // We can schedule the crowdfund first, not reschedule it
    try {
      await crowdfund.reScheduleCrowdfund(firstSchedule);
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
    assert.equal((await token.crowdFundStartTime()).eq(0), true, "Token should have the right start time")


    // call schedule crowdfund NOT from the owner
    try {
      await crowdfund.scheduleCrowdfund(firstSchedule, {from: customer1})
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
    assert.equal((await token.crowdFundStartTime()).eq(0), true, "Token should have the right start time")


    await crowdfund.scheduleCrowdfund(firstSchedule)

    // Buying tokens should fail
    try {
      await crowdfund.buyTokens(owner, {
        from: owner,
        value: web3.toWei('1', 'ether')
      })
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
    assert.equal((await token.balanceOf(owner)).eq(bigNumberize(0, 0)), true, "Should equal")
    assert.equal((await crowdfund.startsAt()).eq(bigNumberize(firstSchedule, 0)), true, "Should equal the firstSchedule")
    assert.equal((await crowdfund.endsAt()).eq(bigNumberize(firstSchedule + totalDays * 24 * 60 * 60, 0)), true, "Should equal days total added")
    assert.equal((await token.crowdFundStartTime()).eq(bigNumberize(firstSchedule, 0)), true, "Token should have the right start time")


    // We can still reschedule the crowdfund
    let secondSchedule = await getTimestampOfCurrentBlock() + 240 + 4*60*60 // 4 minutes

    // call reScheduleCrowdfund NOT from the owner
    try {
      await crowdfund.reScheduleCrowdfund(secondSchedule, {from: customer1})
    } catch (e) {
      ensureException(e)
    }
    await crowdfund.reScheduleCrowdfund(secondSchedule)
    assert.equal((await token.crowdFundStartTime()).eq(bigNumberize(secondSchedule, 0)), true, "Token should have the right start time")


    assert.equal((await crowdfund.startsAt()).eq(bigNumberize(secondSchedule, 0)), true, "Should equal the secondSchedule")
    assert.equal((await crowdfund.endsAt()).eq(bigNumberize(secondSchedule + totalDays * 24 * 60 * 60, 0)), true, "Should equal days total added II")

    // We can reschedule, but not schedule the crowdfund
    try {
      await crowdfund.scheduleCrowdfund(secondSchedule);
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }

    // Jump more than 4 minutes -- we are in the crowdfund
    jumpToTheFuture(360)
    await crowdfund.changeWalletAddress(owner, {from: owner})
    let thirdSchedule = await getTimestampOfCurrentBlock() + 240

    // Cannot schedule or reschedule crowdfund after crowdfund started
    try {
      await crowdfund.scheduleCrowdfund(thirdSchedule);
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }

    try {
      await crowdfund.scheduleCrowdfund(thirdSchedule);
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
  });

  it("Rates per epoch: It should return the right price when buying tokens", async() => {
    const crowdfund = await Crowdfund.new(...crowdfundArgs, {from: owner})
    const token = await Token.at(await crowdfund.token());

    let startDate = await getTimestampOfCurrentBlock() + 100
    await crowdfund.scheduleCrowdfund(startDate)
    // Buying tokens should fail
    try {
      await crowdfund.buyTokens(owner, {
        from: owner,
        value: web3.toWei('1', 'ether')
      });
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
    assert.equal((await token.balanceOf(owner)).eq(bigNumberize(0, 0)), true, "Should equal 0")

    await jumpToTheFuture(500)
      await crowdfund.changeWalletAddress(owner, {from: owner});

    let totalPrices = 0;
    let totalEpochs = 0;
    for (var i = 0; i < epochs.length; i++) {
      let rate = await crowdfund.rates(i)
      let currentRate = await crowdfund.getRate()
      totalEpochs += epochs[i]
      assert.equal((rate[0]).eq(prices[i]), true, "Rates should equal")
      assert.equal((rate[1]).eq(totalEpochs), true, "Epochs should equal")
      totalPrices += prices[i]
      await crowdfund.buyTokens(owner, {
        from: owner,
        value: web3.toWei('1', 'ether')
      })
      assert.equal((await token.balanceOf(owner)).eq(bigNumberize(totalPrices, 18)), true, "Should equal")
      await jumpToTheFuture(epochs[i] * 24 * 60 * 60 + 5000)
      // to adjust the next block
      await crowdfund.changeWalletAddress(owner, {from: owner})
    }

    // 100 Days in the future
    await jumpToTheFuture(100 * 24 * 60 * 60 + 5000)
    // to adjust the next block
    await crowdfund.changeWalletAddress(owner, {from: owner})

    assert.equal((await crowdfund.getRate()).eq(bigNumberize(0, 0)), true, "Should equal 0")

  });

  it("Change Forward and Wallet Address: It should let only the owner to change those " +
      "addresses",
  async() => {
    const crowdfund = await Crowdfund.new(...crowdfundArgs, {from: owner})
    const token = await Token.at(await crowdfund.token());

    // Anyone else is trying to change the wallet address
    try {
      await crowdfund.changeWalletAddress(owner, {from: customer1});
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
    // Same for forward address
    try {
      await crowdfund.changeForwardAddress(owner, {from: customer1});
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }

    assert.equal((await crowdfund.wallet()), receivingAccount, "Wallet should equal")
    assert.equal((await crowdfund.forwardTokensTo()), forwardAddress, "Forward should equal")

    await crowdfund.changeWalletAddress(customer4, {from: owner})
    await crowdfund.changeForwardAddress(customer5, {from: owner})

    assert.equal((await crowdfund.wallet()), customer4, "New Wallet should equal")
    assert.equal((await crowdfund.forwardTokensTo()), customer5, "New Forward should equal")
  });

  it("BuyTokens() and function (): It should let a buyer buy tokens", async() => {
      const wallet = '0xac0782170Acc520e0EF968B149b1d432352f97a2'
      const crowdfund = await Crowdfund.new(...crowdfundArgs, {from: owner})
      const token = await Token.at(await crowdfund.token());


      // Buy tokens when not active Buying tokens should fail
      try {
          await crowdfund.buyTokens(owner, {
              from: owner,
              value: web3.toWei('1', 'ether')
          })
          assert.equal(true,false,"Should fail");
      } catch (e) {
          ensureException(e)
      }
      // Start the crowdfund now
      const timeToStart = await getTimestampOfCurrentBlock() + 100
      await crowdfund.scheduleCrowdfund(timeToStart, {from: owner})

      await jumpToTheFuture(500)
      await crowdfund.changeWalletAddress(wallet, {from: owner})

      assert.equal(await crowdfund.isActivated(), true, "Crowdfund should be active")
      assert.equal(await crowdfund.startsAt(), timeToStart, "Crowdfund should have the right start date")

      // Buy token when active using buyTokens()
      await crowdfund.buyTokens(owner, {
          from: owner,
          value: web3.toWei('1', 'ether')
      })

      assert.equal((await token.balanceOf(owner)).eq(bigNumberize(prices[0], 18)), true, "Should equal balance")
      assert.equal((await crowdfund.weiRaised()).eq(bigNumberize(1, 18)), true, "Should equal: weiraised")
      assert.equal((await crowdfund.tokensSold()).eq(bigNumberize(prices[0], 18)), true, "Should equal tokens sold")
      assert.equal((await web3.eth.getBalance(wallet)).eq(bigNumberize(1, 18)), true, "Should equal: wallet balance")

      // Buy token when active using function()
      await web3
          .eth
          .sendTransaction({
              from: customer1,
              to: crowdfund.address,
              value: web3.toWei('1', 'ether')
          })
      assert.equal((await token.balanceOf(customer1)).eq(bigNumberize(prices[0], 18)), true, "Should equal")
      assert.equal((await crowdfund.weiRaised()).eq(bigNumberize(2, 18)), true, "Should equal")
      assert.equal((await web3.eth.getBalance(wallet)).eq(bigNumberize(2, 18)), true, "Should equal")

      // Buy token when active using function() and zero value
      try {
          await crowdfund.buyTokens(owner, {
              from: owner,
              value: web3.toWei('0', 'ether')
          })
          assert.equal(true,false,"Should fail");
      } catch (e) {
          ensureException(e)
      }

      // Buy token when active using buyTokens() and zero value
      try {
          await crowdfund.buyTokens(owner, {
              from: owner,
              value: web3.toWei('0', 'ether')
          })
          assert.equal(true,false,"Should fail");
      } catch (e) {
          ensureException(e)
      }

      await jumpToTheFuture(twentyEightDaysInSeconds + 200)
      await crowdfund.changeWalletAddress(owner, {from: owner})

      // Buy tokens after crowdfund is done but not closed
      try {
          await crowdfund.buyTokens(customer3, {
              from: customer3,
              value: web3.toWei('0', 'ether')
          })
          assert.equal(true,false,"Should fail");
      } catch (e) {
          ensureException(e)
      }
      assert.equal((await token.balanceOf(customer3)).eq(bigNumberize(0, 18)), true, "Should equal")

      // Buy tokens after crowdfund is closed
      await crowdfund.closeCrowdfund({from: owner})
      try {
          await crowdfund.buyTokens(customer3, {
              from: customer3,
              value: web3.toWei('0', 'ether')
          })
      } catch (e) {
          ensureException(e)
      }
      assert.equal((await token.balanceOf(customer3)).eq(bigNumberize(0, 18)), true, "Should equal")
  });

  it("BuyTokens(): It should not let a buyer buy tokens after there is no more crowdfu" +
      "nd allocation",
  async() => {
    const wallet = '0x99edCE9CeC1296590B67402A73c780bAeB51c4ad'
    const crowdfund = await Crowdfund.new(owner, epochs, prices, receivingAccount, forwardAddress, totalDays, totalSupply, withCrowdfund, allocationAddresses, [
      50000000000000000000000,
      100000000000000000000000,
      50000000000000000000000,
      200000000000000000000000,
      599000000000000000000000,
      1000000000000000000000
    ], // crowdfund gets 1000
        allocationTimelocks, {from: owner})
    const token = await Token.at(await crowdfund.token());

    // Buy tokens when not active Buying tokens should fail
    try {
      await crowdfund.buyTokens(owner, {
        from: owner,
        value: web3.toWei('1', 'ether')
      });
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
    // Start the crowdfund now
    const timeToStart = await getTimestampOfCurrentBlock() + 100
    await crowdfund.scheduleCrowdfund(timeToStart, {from: owner})

    await jumpToTheFuture(500)
    await crowdfund.changeWalletAddress(wallet, {from: owner})

    assert.equal(await crowdfund.isActivated(), true, "Crowdfund should be active")
    assert.equal((await token.crowdFundStartTime()).eq(timeToStart), true, "Token should have the right start time")


    // Buy token when active using buyTokens()
    assert.equal(((await token.allocations(crowdfund.address))[0]).eq(bigNumberize(1000, 18)), true, "Should equal")
    await crowdfund.buyTokens(owner, {
      from: owner,
      value: web3.toWei('1', 'ether')
    })
    assert.equal((await token.balanceOf(owner)).eq(bigNumberize(prices[0], 18)), true, "Should equal")
    assert.equal((await crowdfund.weiRaised()).eq(bigNumberize(1, 18)), true, "Should equal")
    assert.equal(((await token.allocations(crowdfund.address))[0]).eq(bigNumberize(0, 18)), true, "Should be empty")
    // Buying tokens should fail
    try {
      await crowdfund.buyTokens(customer1, {
        from: owner,
        value: web3.toWei('1', 'ether')
      });
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
    assert.equal((await token.balanceOf(customer1)).eq(bigNumberize(0, 18)), true, "Should equal")
    assert.equal((await crowdfund.weiRaised()).eq(bigNumberize(1, 18)), true, "Should equal")
  });

  it("closeCrowdfund(): It should let me close the crowdfund at the appropriate time", async() => {
    const crowdfund = await Crowdfund.new(...crowdfundArgs, {from: owner})
    const token = await Token.at(await crowdfund.token());

    // Close crowdfund before crowdfund starts
    try {
      await crowdfund.closeCrowdfund({from: owner});
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
    assert.equal((await crowdfund.crowdfundFinalized()), false, "Should equal")
    assert.equal((await token.tokensLocked()), true, "Should be locked")

    await crowdfund.scheduleCrowdfund(await getTimestampOfCurrentBlock() + 100, {from: owner})

    await jumpToTheFuture(500)
    await crowdfund.changeWalletAddress(receivingAccount, {from: owner})

    // Close crowdfund during crowdfund
    try {
      await crowdfund.closeCrowdfund({from: owner});
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
    assert.equal((await crowdfund.crowdfundFinalized()), false, "Should equal")
    assert.equal((await token.tokensLocked()), true, "Should be locked")

    await jumpToTheFuture(twentyEightDaysInSeconds + 500)
    await crowdfund.changeWalletAddress(receivingAccount, {from: owner})

    // Close crowdfund when crowdfund is done by customer1
    try {
      await crowdfund.closeCrowdfund({from: customer1});
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
    assert.equal((await crowdfund.crowdfundFinalized()), false, "Should equal")
    assert.equal((await token.tokensLocked()), true, "Should be locked")

    // Close crowdfund when crowdfund is done by owner
    await crowdfund.closeCrowdfund({from: owner})
    assert.equal((await crowdfund.crowdfundFinalized()), true, "Should be closed")
    assert.equal((await token.tokensLocked()), false, "Should be unlocked")
    assert.equal((await token.balanceOf(forwardAddress)).eq(allocationBalances[allocationBalances.length - 1]), true, "Should receive all of the tokens")

    // Retry closing the crowdfund
    try {
      await crowdfund.closeCrowdfund({from: owner});
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
  });

    it("closeCrowdfund(): It should not release more tokens if the crowdfund has no tokens", async() => {
        let amounts = [5000, 100, 500, 200, 10, 0];

        const zeroTokenCrowdfundArgs = [
            owner,
            epochs,
            prices,
            receivingAccount,
            forwardAddress,
            totalDays,
            5810,
            true, // We want the whitelist
            allocationAddresses,
            amounts,
            allocationTimelocks
        ]

        const crowdfund = await Crowdfund.new(...zeroTokenCrowdfundArgs, {from: owner})
        const token = await Token.at(await crowdfund.token());


        await crowdfund.scheduleCrowdfund(await getTimestampOfCurrentBlock() + 100, {from: owner})

        await jumpToTheFuture(500)
        await crowdfund.changeWalletAddress(receivingAccount, {from: owner})


        await jumpToTheFuture(twentyEightDaysInSeconds + 500)
        await crowdfund.changeWalletAddress(receivingAccount, {from: owner})

        // Close crowdfund when crowdfund is done by owner
        await crowdfund.closeCrowdfund({from: owner})
        assert.equal((await crowdfund.crowdfundFinalized()), true, "Should be closed")
        assert.equal((await token.tokensLocked()), false, "Should be unlocked")
        assert.equal((await token.balanceOf(forwardAddress)).eq(amounts[allocationBalances.length - 1]), true, "Should receive all of the tokens")

    });

  it("closeCrowdfund(): It should let me burn tokens", async() => {
    const crowdfund = await Crowdfund.new(owner, epochs, prices, receivingAccount, '0x0', totalDays, totalSupply, withCrowdfund, allocationAddresses, allocationBalances, allocationTimelocks, {from: owner})
    const token = await Token.at(await crowdfund.token());

    // Close crowdfund before crowdfund starts
    try {
      await crowdfund.closeCrowdfund({from: owner});
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
    assert.equal((await crowdfund.crowdfundFinalized()), false, "Should equal")
    assert.equal((await token.tokensLocked()), true, "Should be locked")

    await crowdfund.scheduleCrowdfund(await getTimestampOfCurrentBlock() + 100, {from: owner})

    await jumpToTheFuture(500)
    await crowdfund.changeWalletAddress(receivingAccount, {from: owner})

    // Close crowdfund during crowdfund
    try {
      await crowdfund.closeCrowdfund({from: owner});
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
    assert.equal((await crowdfund.crowdfundFinalized()), false, "Should equal")
    assert.equal((await token.tokensLocked()), true, "Should be locked")

    await jumpToTheFuture(twentyEightDaysInSeconds + 500)
    await crowdfund.changeWalletAddress(receivingAccount, {from: owner})

    // Close crowdfund when crowdfund is done by customer1
    try {
      await crowdfund.closeCrowdfund({from: customer1});
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
    assert.equal((await crowdfund.crowdfundFinalized()), false, "Should equal")
    assert.equal((await token.tokensLocked()), true, "Should be locked")

    // Close crowdfund when crowdfund is done by owner
    await crowdfund.closeCrowdfund({from: owner})
    assert.equal((await crowdfund.crowdfundFinalized()), true, "Should be closed")
    assert.equal((await token.tokensLocked()), false, "Should be unlocked")
    assert.equal((await token.balanceOf('0x0')).eq(allocationBalances[allocationBalances.length - 1]), true, "Should receive all of the tokens")

    // Retry closing the crowdfund
    try {
      await crowdfund.closeCrowdfund({from: owner});
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
  });

  it("deliverPresaleTokens(): It should let me deliver the presale tokens at an approp" +
      "riate time",
  async() => {

    const presaleAddresses = [accounts[1], accounts[2], accounts[3], accounts[4], accounts[5]];
    const presaleAmounts = [1000000000000000000, 500000000000000000, 10000000000000000000, 1102330505704040302, 13700000000000000000];
    const crowdfund = await Crowdfund.new(...crowdfundArgs, {from: owner})
    const token = await Token.at(await crowdfund.token());

    // deliver presale tokens before scheduling the crowdfund form owner
    try {
      await crowdfund.deliverPresaleTokens(presaleAddresses, presaleAmounts, {from: owner});
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }

    // deliver presale tokens before scheduling the crowdfund from anyone
    try {
      await crowdfund.deliverPresaleTokens(presaleAddresses, presaleAmounts, {from: customer1});
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }

    // deliver presale tokens before the crowdfund (scheduled)
    await crowdfund.scheduleCrowdfund(await getTimestampOfCurrentBlock() + 100, {from: owner})
    // await jumpToTheFuture(500)

      // send non equal lengths of arrays
      let badPresaleAmounts = [1000000000000000000, 500000000000000000, 10000000000000000000, 1102330505704040302];
      try {
          await crowdfund.deliverPresaleTokens(presaleAddresses, badPresaleAmounts, {from: owner});
          assert.equal(true,false,"Should fail");
      } catch (e) {
          ensureException(e)
      }

      // provide an amount higher than crowdfund has available
      badPresaleAmounts = [1000000000000000000, 500000000000000000, 10000000000000000000, 1102330505704040302, 500000000000000000000000];
      try {
          await crowdfund.deliverPresaleTokens(presaleAddresses, badPresaleAmounts, {from: owner});
          assert.equal(true,false,"Should fail");
      } catch (e) {
          ensureException(e)
      }

    await crowdfund.deliverPresaleTokens(presaleAddresses, presaleAmounts, {from: owner});
    for (let i = 0; i < presaleAddresses.length; i++) {
      const balance = await token.balanceOf(presaleAddresses[i]);
      assert.equal(balance.toNumber(), presaleAmounts[i]);
    }

    await jumpToTheFuture(500)
    await crowdfund.changeWalletAddress(receivingAccount, {from: owner})

    // deliver presale tokens during the crowdfund

    await jumpToTheFuture(twentyEightDaysInSeconds + 500)
    await crowdfund.changeWalletAddress(receivingAccount, {from: owner})


    // deliver presale tokens after the crowdfund
    try {
      await crowdfund.deliverPresaleTokens(presaleAddresses, presaleAmounts, {from: owner});
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
  });

  it("WHITELISTED BuyTokens() and function (): It should let a buyer buy tokens only i" +
      "f whitelisted",
  async() => {

    const newCrowdfundArgs = [
      owner,
      epochs,
      prices,
      receivingAccount,
      forwardAddress,
      totalDays,
      totalSupply,
      true, // We want the whitelist
      allocationAddresses,
      allocationBalances,
      allocationTimelocks
    ]

    const wallet = '0xDFaA222a5ce7f361e87A85905272C2F02fb19195'
    const crowdfund = await Crowdfund.new(...newCrowdfundArgs, {from: owner})
    const token = await Token.at(await crowdfund.token());

    // Buy tokens when not active Buying tokens should fail
    try {
      await crowdfund.buyTokens(customer1, {
        from: customer1,
        value: web3.toWei('1', 'ether')
      });
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
    // Start the crowdfund now
    await crowdfund.scheduleCrowdfund(await getTimestampOfCurrentBlock() + 100, {from: owner})

    await jumpToTheFuture(500)
    await crowdfund.changeWalletAddress(wallet, {from: owner})

    await assertRevert(crowdfund.changeWalletAddress(0x0, {from: owner}));

    assert.equal(await crowdfund.isActivated(), true, "Crowdfund should be active")

    // Buy tokens the owner is not whitelisted
    try {
      await crowdfund.buyTokens(customer1, {
        from: customer1,
        value: web3.toWei('1', 'ether')
      });
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }

    // Whitelist customer1
    assert.equal((await crowdfund.whitelist(customer1)), false, "Should be false")
    await crowdfund.addToWhitelist(customer1, {from: owner})
    await jumpToTheFuture(500)
    await crowdfund.changeWalletAddress(wallet, {from: owner})
    assert.equal((await crowdfund.whitelist(customer1)), true, "Should equal")

    // Buy token when active using buyTokens()
    await crowdfund.buyTokens(customer1, {
      from: customer1,
      value: web3.toWei('1', 'ether')
    })


    let amountShouldHaveSold = web3.toWei('1', 'ether')
    let rate = await crowdfund.getRate();
    let amountOfTokensSold = await crowdfund.getTokensSold()

    assert.equal(amountOfTokensSold, amountShouldHaveSold * rate, "Should equal")  ;
    assert.equal((await token.balanceOf(customer1)).eq(bigNumberize(prices[0], 18)), true, "Should equal")
    assert.equal((await crowdfund.weiRaised()).eq(bigNumberize(1, 18)), true, "Should equal")
    assert.equal((await web3.eth.getBalance(wallet)).eq(bigNumberize(1, 18)), true, "Should equal")
    // Whitelist customer2
    assert.equal((await crowdfund.whitelist(customer2)), false, "Should be false")
    await crowdfund.addToWhitelist(customer2, {from: owner})
    await jumpToTheFuture(500)
    await crowdfund.changeWalletAddress(wallet, {from: owner})
    assert.equal((await crowdfund.whitelist(customer2)), true, "Should equal")

    // Buy token when active and customer2 whitelisted using function()
    await web3
    .eth
    .sendTransaction({
      from: customer2,
      to: crowdfund.address,
      value: web3.toWei('1', 'ether')
    })
    assert.equal((await token.balanceOf(customer2)).eq(bigNumberize(prices[0], 18)), true, "Should equal")
    assert.equal((await crowdfund.weiRaised()).eq(bigNumberize(2, 18)), true, "Should equal")
    assert.equal((await web3.eth.getBalance(wallet)).eq(bigNumberize(2, 18)), true, "Should equal")

    // Buy token when active using function() and zero value
    try {
      await crowdfund.buyTokens(owner, {
        from: owner,
        value: web3.toWei('0', 'ether')
      });
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }

    // Remove customer1 from the whitelist
    await crowdfund.removeFromWhitelist(customer1, {from: owner})
    try {
      await crowdfund.buyTokens(customer1, {
        from: customer1,
        value: web3.toWei('1', 'ether')
      });
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
    assert.equal((await token.balanceOf(customer1)).eq(bigNumberize(prices[0], 18)), true, "Should equal")
    assert.equal((await crowdfund.weiRaised()).eq(bigNumberize(2, 18)), true, "Should equal")
    assert.equal((await web3.eth.getBalance(wallet)).eq(bigNumberize(2, 18)), true, "Should equal")

    // Remove customer2 from the whitelist
    await crowdfund.removeFromWhitelist(customer2, {from: owner})
    try {
      await web3
      .eth
      .sendTransaction({
        from: customer2,
        to: crowdfund.address,
        value: web3.toWei('1', 'ether')
      });
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
    assert.equal((await token.balanceOf(customer2)).eq(bigNumberize(prices[0], 18)), true, "Should equal")
    assert.equal((await crowdfund.weiRaised()).eq(bigNumberize(2, 18)), true, "Should equal")
    assert.equal((await web3.eth.getBalance(wallet)).eq(bigNumberize(2, 18)), true, "Should equal")

    // Buy token when active using buyTokens() and zero value
    try {
      await crowdfund.buyTokens(owner, {
        from: owner,
        value: web3.toWei('0', 'ether')
      });
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }

    await jumpToTheFuture(twentyEightDaysInSeconds + 200)
    await crowdfund.changeWalletAddress(owner, {from: owner})

    // Buy tokens after crowdfund is done but not closed
    try {
      await crowdfund.buyTokens(customer3, {
        from: customer3,
        value: web3.toWei('0', 'ether')
      });
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
    assert.equal((await token.balanceOf(customer3)).eq(bigNumberize(0, 18)), true, "Should equal")

    assert.equal((await crowdfund.whitelist(customer3)), false, "Should be false")
    assert.equal((await crowdfund.whitelist(customer4)), false, "Should be false")
    assert.equal((await crowdfund.whitelist(customer5)), false, "Should be false")
    await crowdfund.addManyToWhitelist([customer3, customer4, customer5])
    assert.equal((await crowdfund.whitelist(customer3)), true, "Should be true")
    assert.equal((await crowdfund.whitelist(customer4)), true, "Should be true")
    assert.equal((await crowdfund.whitelist(customer5)), true, "Should be true")
    await crowdfund.removeFromWhitelist(customer3, {from: owner})
    await crowdfund.removeFromWhitelist(customer4, {from: owner})
    await crowdfund.removeFromWhitelist(customer5, {from: owner})
    await crowdfund.addManyToWhitelist([customer3, customer4, customer5])
    assert.equal((await crowdfund.whitelist(customer3)), true, "Should be true")
    assert.equal((await crowdfund.whitelist(customer4)), true, "Should be true")
    assert.equal((await crowdfund.whitelist(customer5)), true, "Should be true")
    await crowdfund.removeManyFromWhitelist([customer3, customer4, customer5], {from: owner})
    assert.equal((await crowdfund.whitelist(customer3)), false, "Should be false")
    assert.equal((await crowdfund.whitelist(customer4)), false, "Should be false")
    assert.equal((await crowdfund.whitelist(customer5)), false, "Should be false")

    // Buy tokens after crowdfund is closed
    await crowdfund.closeCrowdfund({from: owner})
    try {
      await crowdfund.buyTokens(customer3, {
        from: customer3,
        value: web3.toWei('0', 'ether')
      });
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
    assert.equal((await token.balanceOf(customer3)).eq(bigNumberize(0, 18)), true, "Should equal")
  });

    it("Should refund a user if they buy more tokens than the crowdsale has available",
        async() => {

            const newCrowdfundArgs = [
                owner,
                epochs,
                [1,1,1,1],
                receivingAccount,
                forwardAddress,
                totalDays,
                100,
                true, // We want the whitelist
                allocationAddresses,
                [
                    10,
                    10,
                    10,
                    10,
                    10,
                    50
                ],
                allocationTimelocks
            ]

            const wallet = '0xDFaA222a5ce7f361e87A85905272C2F02fb19195'
            const crowdfund = await Crowdfund.new(...newCrowdfundArgs, {from: owner})
            const token = await Token.at(await crowdfund.token());


            // Start the crowdfund now
            await crowdfund.scheduleCrowdfund(await getTimestampOfCurrentBlock() + 100, {from: owner})

            await jumpToTheFuture(500)
            await crowdfund.addToWhitelist(customer1, {from: owner})
            await jumpToTheFuture(500)
            await crowdfund.changeWalletAddress(wallet, {from: owner})

            let amountOfTokensToBuy = 51;

            // Buy token when active using buyTokens()
            await crowdfund.buyTokens(customer1, {
                from: customer1,
                value: amountOfTokensToBuy
            })

            let amountOfTokens = await token.balanceOf(customer1);
            assert.equal(amountOfTokens, amountOfTokensToBuy - 1, "Did not purchase the correct amount of tokens")

        });

 it("changeCrowdfundStartTime, Should not let me call this function", async() => {

    const crowdfund = await Crowdfund.new(...crowdfundArgs, {from: owner})
    const token = await Token.at(await crowdfund.token());

    // Buy tokens when not active Buying tokens should fail
    try {
      await token.changeCrowdfundStartTime(1455545454, {
        from: customer1
      });
        assert.equal(true,false,"Should fail");
    } catch (e) {
      ensureException(e)
    }
  });

    it("constructing a crowdsale with multiple 0 zero addresses should revert", async() => {

        const owner = accounts[0];
        const receivingAccount = accounts[1];

        const TokenGeneration = '0x0'
        const Team = accounts[2];
        const Sales = accounts[3];


        const twentyEightDaysInSeconds = 2419200;
        const prices = [1, 1, 1, 1] // 1*10^18 * 1000
        const epochs = [3, 4, 7, 14]
        const totalDays = 28
        const allocationAddresses = [TokenGeneration, Team, Sales, "0x0", "0x0"]
        const allocationBalances = [
            3,
            3,
            1,
            2,
            1
        ]

        const allocationTimelocks = [0, 0, 0, 0, 0]
        const totalSupply_ = 10;
        const withCrowdfund = false
        const crowdfundArgs = [
            owner,
            epochs,
            prices,
            receivingAccount,
            TokenGeneration,
            totalDays,
            totalSupply_,
            withCrowdfund,
            allocationAddresses,
            allocationBalances,
            allocationTimelocks
        ]

        try {
            // Crowdfund.class_defaults
            const crowdfund = await Crowdfund.new(
                ...crowdfundArgs, {
                    from: owner
                }
            );

            assert.equal(true,false,"Should fail")
        } catch (e) {
            ensureException(e)
        }



    });
});
